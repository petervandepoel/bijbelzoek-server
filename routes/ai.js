// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

const router = Router();

/** ───────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────── */
const isMode = (m) => ["bijbelstudie", "preek", "liederen"].includes((m || "").toLowerCase());
const enc = (s) => encodeURIComponent(s || "");
const joinQ = (theme, keywords = []) =>
  [theme || "", ...keywords].filter(Boolean).join(" ").trim();

/** Parse JSON terug uit een LLM string (veilig, tolerant voor codeblokken) */
function safeJsonParse(maybeJson) {
  if (!maybeJson) return null;
  let txt = String(maybeJson).trim();

  // strip markdown fences
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) txt = fence[1];

  // harden: neem grootste {...} blok
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    txt = txt.slice(start, end + 1);
  }

  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function getSystem(mode) {
  return `
Je bent een Nederlandstalige assistent voor Bijbelstudie/Preek/Liederen (HSV/NKJV).
- Wees nauwkeurig, theologisch verantwoord, Christus-centraal en pastoraal.
- Verwijs compact naar Schrift (bijv. "Rom. 8:1").
- Geen verzonnen bronnen. Bij 'Actueel' of externe verwijzingen: alleen echte, generieke zoek-aanzetten of openbare bronnen — geen fake citaten/urls.
- Output **ALLEEN JSON** volgens het schema dat ik je geef; geen extra tekst buiten JSON.
`.trim();
}

/** Schema-instructie voor consistente structured-output */
function composePrompt({ mode, context = {}, extra = "" }) {
  return `
Je taak: lees de CONTEXT, maak eerst een **contextanalyse**, en lever daarna uitgewerkte inhoud.
Houd je 100% aan dit JSON-schema (voorbeeldwaarden zijn indicatief):

{
  "type": "${mode}",
  "title": "string",
  "context": {
    "summary": "korte samenvatting van geselecteerde grafieken/teksten/opmerkingen en thema",
    "insights": ["bullet", "bullet", "bullet"],
    "answered_questions": ["antwoord op concrete vraag 1", "antwoord 2"]
  },
  "verses": [ { "ref": "Joh. 3:16", "text": "..." } ],
  "central_passages": [
    { "ref": "Rom. 8:1-11", "reason": "waarom centraal" },
    { "ref": "Jes. 53:1-12", "reason": "waarom centraal" }
  ],

  "summary": "inleiding/overzicht",
  "outline": ["kop 1", "kop 2", "kop 3"],
  "background": ["historische/taalkundige/exegetische notitie ..."],
  "discussion": ["gespreksvraag 1", "gespreksvraag 2"],
  "application": ["toepassing 1", "toepassing 2"],
  "prayer": "kort gebed (wees concreet, Schrift-gevoed)",

  "christocentric": "${mode === "preek" ? "Christus centraal uitgelegd in dit thema" : ""}",

  "songs": {
    "Psalmen": [ { "number": 23, "title": "De Heer is mijn herder" } ],
    "Opwekking": [ { "number": 599, "title": "Tienduizend redenen" } ],
    "Op Toonhoogte": [ { "number": 123, "title": "..." } ],
    "Even Wat Anders": [
      { "category": "klassiek|gospel|instrumentaal|dans",
        "title": "bijv. Bach BWV 147 (Jesu, Joy of Man’s Desiring)",
        "composer": "optioneel",
        "link": "optioneel (alleen echte, algemene pagina zoals Wikipedia/YouTube zoekresultaat)" }
    ]
  },

  "notes": ["optioneel: aanvullende opmerkingen"]
}

CONTEXT (gebruik dit maximaal):
${JSON.stringify(context, null, 2)}

Extra instructies:
${extra || "-"}
`.trim();
}

/** ───────────────────────────────────────────────────────────
 * Health
 * ─────────────────────────────────────────────────────────── */
router.get("/health", (req, res) => res.json({ ok: true }));

/** ───────────────────────────────────────────────────────────
 * Compose (JSON)
 * ─────────────────────────────────────────────────────────── */
router.post("/compose", async (req, res, next) => {
  try {
    let { mode = "bijbelstudie", context, extra = "" } = req.body || {};
    mode = String(mode).toLowerCase();
    if (!isMode(mode)) {
      return res.status(400).json({ error: "invalid_mode", hint: "bijbelstudie|preek|liederen" });
    }

    const { text: raw, usage } = await callLLM({
      system: getSystem(mode),
      prompt: composePrompt({ mode, context, extra }),
      temperature: mode === "liederen" ? 0.7 : 0.55,
      max_tokens: 5000,
    });

    const structured = safeJsonParse(raw);
    if (!structured || typeof structured !== "object") {
      return res.status(502).json({
        error: "bad_llm_json",
        rawSnippet: String(raw).slice(0, 500)
      });
    }

    res.json({ structured, usage });
  } catch (e) { next(e); }
});

/** ───────────────────────────────────────────────────────────
 * Streaming (optioneel)
 * ─────────────────────────────────────────────────────────── */
router.post("/compose/stream", async (req, res) => {
  try {
    let { mode = "bijbelstudie", context, extra = "" } = req.body || {};
    mode = String(mode).toLowerCase();
    if (!isMode(mode)) {
      res.writeHead(400, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(`event: error\ndata: ${JSON.stringify({ message: "invalid_mode" })}\n\n`);
      return res.end();
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    await streamLLM({
      system: getSystem(mode),
      prompt: composePrompt({ mode, context, extra }),
      temperature: mode === "liederen" ? 0.7 : 0.55,
      max_tokens: 5000,
      onDelta: (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`),
      onEnd: (meta) => {
        res.write(`event: end\n`);
        res.write(`data: ${JSON.stringify({ done: true, usage: meta?.usage || null })}\n\n`);
        res.end();
      },
    });
  } catch (e) {
    try {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: e?.message || String(e) })}\n\n`);
      res.end();
    } catch {}
  }
});

/** ───────────────────────────────────────────────────────────
 * Actueel: klikbare zoek-links (geen API-key nodig)
 * ─────────────────────────────────────────────────────────── */
router.post("/actueel", async (req, res) => {
  const { theme = "", keywords = [] } = req.body || {};
  const q = joinQ(theme, keywords);
  const qEnc = enc(q);

  const links = [
    { title: `NOS – zoek: ${q}`, url: `https://nos.nl/zoeken/?q=${qEnc}`, source: "NOS" },
    { title: `Nederlands Dagblad – zoek: ${q}`, url: `https://www.nd.nl/zoek?query=${qEnc}`, source: "ND" },
    { title: `Trouw – zoek: ${q}`, url: `https://www.trouw.nl/zoeken?query=${qEnc}`, source: "Trouw" },
    { title: `Reformatorisch Dagblad – zoek: ${q}`, url: `https://www.rd.nl/zoeken?q=${qEnc}`, source: "RD" },
    { title: `BBC – zoek: ${q}`, url: `https://www.bbc.co.uk/search?q=${qEnc}`, source: "BBC" },
    { title: `The Gospel Coalition – zoek: ${q}`, url: `https://www.thegospelcoalition.org/?s=${qEnc}`, source: "TGC" }
  ];

  res.json({ theme: q, links });
});

/** ───────────────────────────────────────────────────────────
 * Media: beelden/filmpjes/kunst (klikbare zoek-links)
 * ─────────────────────────────────────────────────────────── */
router.post("/media", async (req, res) => {
  const { theme = "", keywords = [] } = req.body || {};
  const q = joinQ(theme, keywords);
  const qEnc = enc(q);

  const media = [
    { title: `YouTube – ${q}`, type: "video", url: `https://www.youtube.com/results?search_query=${qEnc}`, source: "YouTube" },
    { title: `Wikimedia Commons – ${q}`, type: "images", url: `https://commons.wikimedia.org/w/index.php?search=${qEnc}&title=Special:MediaSearch`, source: "Wikimedia" },
    { title: `Unsplash – ${q}`, type: "photos", url: `https://unsplash.com/s/photos/${qEnc}`, source: "Unsplash" },
    { title: `Pexels – ${q}`, type: "photos", url: `https://www.pexels.com/search/${qEnc}/`, source: "Pexels" },
    { title: `Rijksmuseum – ${q}`, type: "art", url: `https://www.rijksmuseum.nl/en/search?q=${qEnc}`, source: "Rijksmuseum" },
    { title: `The Met Collection – ${q}`, type: "art", url: `https://www.metmuseum.org/art/collection/search#!?q=${qEnc}`, source: "The Met" },
    { title: `Artvee – ${q}`, type: "art", url: `https://artvee.com/?s=${qEnc}`, source: "Artvee" }
  ];

  res.json({ theme: q, media });
});

export default router;
