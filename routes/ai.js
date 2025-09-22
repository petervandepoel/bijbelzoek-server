// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

const router = Router();

/** Helpers **/
const isMode = (m) => ["bijbelstudie", "preek", "liederen", "actueelmedia"].includes((m || "").toLowerCase());
const enc = (s) => encodeURIComponent(s || "");
const joinQ = (theme, keywords = []) => [theme || "", ...keywords].filter(Boolean).join(" ").trim();

function safeJsonParse(maybeJson) {
  if (!maybeJson) return null;
  let txt = String(maybeJson).trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) txt = fence[1];
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) txt = txt.slice(start, end + 1);
  try { return JSON.parse(txt); } catch { return null; }
}

function getSystem(mode) {
  return `
Je bent een Nederlandstalige assistent voor Bijbelstudie/Preek/Liederen/Actueel & Media (HSV/NKJV).
- Wees nauwkeurig, theologisch verantwoord, Christus-centraal en pastoraal.
- Verwijs compact naar Schrift (bijv. "Rom. 8:1").
- Geen verzonnen bronnen/urls. Bij externe verwijzingen: alleen echte, controleerbare info.
- Bij JSON-modus: output **ALLEEN JSON** volgens schema – geen extra tekst buiten JSON.
`.trim();
}

/* ===== Structured (JSON) prompt ===== */
function composePrompt({ mode, context = {}, extra = "" }) {
  return `
Je taak: lees de CONTEXT, maak eerst een **contextanalyse**, en lever daarna uitgewerkte inhoud.
Houd je 100% aan dit JSON-schema:

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
  "prayer": "kort gebed (Schrift-gevoed)",

  "christocentric": "${mode === "preek" ? "Christus centraal uitgelegd in dit thema" : ""}",

  "songs": {
    "Psalmen": [ { "number": 23, "title": "De HEER is mijn herder" } ],
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

CONTEXT:
${JSON.stringify(context, null, 2)}

EXTRA:
${extra || "-"}
`.trim();
}

/* ===== Proza (leesbaar) prompt – voor streaming in UI ===== */
function prosePrompt({ mode, context = "", extra = "" }) {
  const label =
    mode === "preek" ? "Preek" :
    mode === "liederen" ? "Liederen" :
    mode === "actueelmedia" ? "Actueel & Media" :
    "Bijbelstudie";

  return `
Schrijf in het Nederlands een goed leesbare, direct bruikbare ${label}-opzet op basis van de CONTEXT.
Richtlijnen:
- Begin met: wat valt op in de context (teksten, grafieken, notities)? Gebruik 2–4 zinnen, helder en warm.
- Gebruik duidelijke kopjes (##), korte alinea's, lijstjes met • bullets en korte verwijzingen (bv. Rom. 8:1).
- Voeg praktische toepassing toe en (indien passend) 1–2 gebedspunten.
- GEEN JSON – alleen nette proza/opsommingen.

CONTEXT
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

EXTRA
${extra || "-"}
`.trim();
}

/** Health **/
router.get("/health", (req, res) => res.json({ ok: true }));

/** Compose (JSON) – non-stream **/
router.post("/compose", async (req, res, next) => {
  try {
    let { mode = "bijbelstudie", context, extra = "" } = req.body || {};
    mode = String(mode).toLowerCase();
    if (!isMode(mode)) return res.status(400).json({ error: "invalid_mode", hint: "bijbelstudie|preek|liederen|actueelmedia" });

    const { text: raw, usage } = await callLLM({
      system: getSystem(mode),
      prompt: composePrompt({ mode, context, extra }),
      temperature: mode === "liederen" ? 0.7 : 0.55,
      max_tokens: 5000,
    });

    const structured = safeJsonParse(raw);
    if (!structured || typeof structured !== "object") {
      return res.status(502).json({ error: "bad_llm_json", rawSnippet: String(raw).slice(0, 500) });
    }
    res.json({ structured, usage });
  } catch (e) { next(e); }
});

/** Compose – STREAM (SSE)
 * Body: { mode, context, extra, format: "prose"|"json" }
 */
router.post("/compose/stream", async (req, res) => {
  try {
    let { mode = "bijbelstudie", context, extra = "", format = "json" } = req.body || {};
    mode = String(mode).toLowerCase();
    if (!isMode(mode)) {
      res.writeHead(400, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(`event: error\ndata: ${JSON.stringify({ message: "invalid_mode" })}\n\n`);
      return res.end();
    }

    const prompt = format === "prose"
      ? prosePrompt({ mode, context, extra })
      : composePrompt({ mode, context, extra });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    await streamLLM({
      system: getSystem(mode),
      prompt,
      temperature: mode === "liederen" ? 0.7 : 0.55,
      max_tokens: 5000,
      onDelta: (chunk) => res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`),
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

/** ======= ÉCHTE LINKS ======= **/
const qEnc = (s) => encodeURIComponent(s || "");
const fetchText = (url) => fetch(url, { headers: { "User-Agent": "bijbelzoek/1.0" }}).then(r => r.text());
const fetchJSON = (url) => fetch(url, { headers: { "User-Agent": "bijbelzoek/1.0" }}).then(r => r.json());

// 1) Google News RSS → echte nieuwsartikelen
async function getNewsLinks(query, limit = 6) {
  const url = `https://news.google.com/rss/search?q=${qEnc(query)}&hl=nl&gl=NL&ceid=NL:nl`;
  const xml = await fetchText(url);
  const items = [];
  const itemRe = /<item>[\s\S]*?<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < limit) {
    const block = m[0];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1]
               || (block.match(/<title>(.*?)<\/title>/) || [])[1];
    const link  = (block.match(/<link>(.*?)<\/link>/) || [])[1];
    if (title && link) items.push({ title, url: link, source: "News" });
  }
  return items;
}

// 2) YouTube watch-links via DuckDuckGo HTML + regex
async function getYouTubeLinks(query, limit = 6) {
  const url = `https://duckduckgo.com/html/?q=${qEnc("site:youtube.com " + query)}`;
  const html = await fetchText(url);
  const rx = /https:\/\/www\.youtube\.com\/watch\?v=[\w\-]{6,}/g;
  const set = new Set();
  const out = [];
  let m;
  while ((m = rx.exec(html)) && out.length < limit) {
    const link = m[0];
    if (set.has(link)) continue;
    set.add(link);
    out.push({ title: `YouTube: ${query}`, url: link, source: "YouTube", type: "video" });
  }
  return out;
}

// 3) Wikimedia Commons API → directe image-bestanden
async function getCommonsImages(query, limit = 6) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${qEnc(query)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
  const json = await fetchJSON(url);
  const pages = json?.query?.pages || {};
  const out = Object.values(pages).map(p => ({
    title: p.title,
    url: p.imageinfo?.[0]?.url,
    source: "Wikimedia",
    type: "image"
  })).filter(x => x.url);
  return out.slice(0, limit);
}

// POST /api/ai/actueel-media – levert echte links
router.post("/actueel-media", async (req, res) => {
  try {
    const { theme = "", keywords = [] } = req.body || {};
    const q = joinQ(theme, keywords);
    if (!q) return res.json({ theme: "", news: [], videos: [], images: [] });

    const [news, videos, images] = await Promise.all([
      getNewsLinks(q, 6),
      getYouTubeLinks(q, 6),
      getCommonsImages(q, 6),
    ]);

    res.json({ theme: q, news, videos, images });
  } catch (e) {
    res.status(500).json({ error: "actueel_media_failed", message: e?.message || "failed" });
  }
});

/** (oude) actueel/media als zoek-URL’s – mag blijven voor backward compat */
router.post("/actueel", async (req, res) => {
  const { theme = "", keywords = [] } = req.body || {};
  const q = joinQ(theme, keywords);
  const qE = enc(q);
  const links = [
    { title: `NOS – zoek: ${q}`, url: `https://nos.nl/zoeken/?q=${qE}`, source: "NOS" },
    { title: `Nederlands Dagblad – zoek: ${q}`, url: `https://www.nd.nl/zoek?query=${qE}`, source: "ND" },
    { title: `Trouw – zoek: ${q}`, url: `https://www.trouw.nl/zoeken?query=${qE}`, source: "Trouw" },
  ];
  res.json({ theme: q, links });
});
router.post("/media", async (req, res) => {
  const { theme = "", keywords = [] } = req.body || {};
  const q = joinQ(theme, keywords);
  const qE = enc(q);
  const media = [
    { title: `YouTube – ${q}`, type: "video", url: `https://www.youtube.com/results?search_query=${qE}`, source: "YouTube" },
    { title: `Wikimedia – ${q}`, type: "images", url: `https://commons.wikimedia.org/w/index.php?search=${qE}&title=Special:MediaSearch`, source: "Wikimedia" },
  ];
  res.json({ theme: q, media });
});

export default router;
