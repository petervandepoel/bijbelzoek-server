// server/routes/ai.js
import { Router } from "express";
const router = Router();

/* ===========================
   Helpers & constants
   =========================== */

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "gpt-4.1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function ensureHttps(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return "https://" + url.replace(/^\/+/, "");
}

function ytSearchLink(title) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(title || "")}`;
}

function postProcessResult(mode, parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;

  // Liederen: url fallback naar YouTube search
  if (parsed.type === "liederen" && parsed.songs && typeof parsed.songs === "object") {
    for (const key of Object.keys(parsed.songs)) {
      const arr = parsed.songs[key];
      if (Array.isArray(arr)) {
        parsed.songs[key] = arr.map((song) => {
          const s = { ...song };
          if (!s.url && s.title) s.url = ytSearchLink(s.title);
          if (s.url) s.url = ensureHttps(s.url);
          return s;
        });
      }
    }
  }

  // Actueel & Media: normaliseer urls
  if (parsed.type === "actueelmedia") {
    if (Array.isArray(parsed.news)) {
      parsed.news = parsed.news.map((n) => ({ ...n, url: ensureHttps(n.url) }));
    }
    if (Array.isArray(parsed.media)) {
      parsed.media = parsed.media.map((m) => ({
        ...m,
        url: m.url ? ensureHttps(m.url) : ytSearchLink(m.title),
      }));
    }
  }

  return parsed;
}

function safeJsonParse(raw) {
  if (!raw) return null;
  let txt = String(raw).trim();

  // haal code fences weg
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) txt = fence[1];

  // probeer binnenste { ... } te pakken
  const s = txt.indexOf("{");
  const e = txt.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) {
    txt = txt.slice(s, e + 1);
  }

  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/* ===========================
   System messages (per mode)
   =========================== */

function systemMessage(mode) {
  switch (mode) {
    case "preek":
      return "Je bent een Nederlandstalige predikant-assistent die preekvoorbereiding levert met heldere structuur en theologische diepgang.";
    case "liederen":
      return "Je bent een Nederlandstalige muziek-assistent die passende liederen vindt en linkt. Lever directe links; bij onbekend: YouTube-zoeklink.";
    case "actueelmedia":
      return "Je bent een Nederlandstalige nieuws- en media-assistent. Je levert compacte samenvattingen en echte deeplinks naar betrouwbare (christelijke) bronnen.";
    default:
      return "Je bent een Nederlandstalige bijbelstudie-assistent die rijke, contextvolle studies schrijft met volledige tekstgedeelten, vragen, toepassing en gebed.";
  }
}

/* ===========================
   Streaming (proza) prompts
   =========================== */

function prosePrompt(mode, context, extra = "") {
  // context kan 'version' bevatten (HSV/NKJV)
  const versionNote =
    typeof context === "string"
      ? ""
      : (context && context.includes?.("HSV")) ? "HSV"
        : (context && context.includes?.("NKJV")) ? "NKJV"
          : "";

  if (mode === "preek") {
    return `Schrijf een PREek in goed leesbaar Nederlands met duidelijke kopjes. 
GEEN JSON, alleen proza. Gebruik "##" en "-" voor opsommingen.

Structuur:
## Titel & Inleiding
## Hoofdlijnen (3 punten, helder geformuleerd)
## Achtergrond & Verbanden (taalkundig, historisch, theologisch)
## Speciaal voor de kinderen (eenvoudige uitleg of voorbeeld)
## Toepassing
## Gebed
## Homiletische tips (beeldspraak/retoriek)

Context (samengevat):
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  if (mode === "liederen") {
    return `Schrijf een beknopte toelichting en lijst vervolgens passende liederen bij dit thema. 
GEEN JSON, alleen proza. Gebruik categorieën met "##" en opsommingen "-".

Structuur:
## Intro
## Psalmen
- Titel (Nummer) — Link
## Opwekking
- Titel (Nummer) — Link
## Op Toonhoogte
- Titel (Nummer) — Link
## Overige
- Titel — Link (klassiek/gospel/YouTube)

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  if (mode === "actueelmedia") {
    return `Schrijf een korte analyse en laat daarna lijstjes zien met Nieuws en Media. 
GEEN JSON, alleen proza. Gebruik "##" kopjes en lijstjes met "-". Gebruik echte deeplinks (geen homepages).

Structuur:
## Analyse
## Nieuws
- Titel — (bron) — deeplink — 1–2 zinnen samenvatting
## Media
- Titel — (type/bron) — deeplink — 1 zin duiding

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  // bijbelstudie (default)
  return `Schrijf een BIJBELSTUDIE in goed leesbaar Nederlands.
GEEN JSON, alleen proza. Gebruik "##" en "-" voor opsommingen.
Indien mogelijk gebruik de gevraagde vertaling (${versionNote || "HSV of NKJV"}).

Structuur:
## Samenvatting & context
## Centraal gedeelte 1 (volledige tekst) + uitleg waarom centraal
## Centraal gedeelte 2 (volledige tekst) + uitleg waarom centraal
## Vragen voor kringgesprek (3–5)
## Toepassing (concreet)
## Gebed (kort)

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
}

/* ===========================
   JSON (compose) prompts
   =========================== */

function jsonPrompt(mode, context, extra = "") {
  const baseHeader = `Geef ALLEEN geldige JSON, geen toelichting of tekst buiten JSON. Gebruik exact deze veldnamen.`;

  if (mode === "preek") {
    return `${baseHeader}
Schema:
{
  "type":"preek",
  "title":"string",
  "summary":"string",
  "outline":["punt1","punt2","punt3"],
  "background":["string"],
  "application":["string"],
  "prayer":"string",
  "children_block":"string",
  "homiletical_tips":["string"]
}

Vereisten:
- "outline" bevat precies 3 korte, krachtige punten.
- "background" bevat taalkundige/historische/theologische notities.
- "children_block" is simpel en aansprekend.
- "application" is concreet.

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  if (mode === "liederen") {
    return `${baseHeader}
Schema:
{
  "type":"liederen",
  "songs":{
    "psalms":[{"number":23,"title":"De HEER is mijn Herder","url":"https://..."}],
    "opwekking":[{"number":599,"title":"Tienduizend redenen","url":"https://..."}],
    "op_toonhoogte":[{"number":321,"title":"Zegen ons Algoede","url":"https://..."}],
    "others":[{"title":"How Great Thou Art","composer":"Stuart K. Hine","url":"https://..."}]
  }
}

Vereisten:
- Voeg voor elk lied een werkende url toe (liedtekstpagina of uitvoering).
- Als geen url bekend is: genereer een geldige YouTube-zoeklink op basis van de titel.
- Orden de liederen logisch bij het thema.

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  if (mode === "actueelmedia") {
    return `${baseHeader}
Schema:
{
  "type":"actueelmedia",
  "news":[{"title":"...","url":"https://...","source":"NOS|NU.nl|EO|CIP|Refoweb|ND|RD","summary":"1–2 zinnen"}],
  "media":[{"title":"...","url":"https://youtube.com/watch?v=...","type":"video|audio|image","source":"YouTube|Vimeo|Omroep|Podcast"}]
}

Vereisten:
- Gebruik echte deeplinks (geen homepages). Bijvoorbeeld: "https://nos.nl/artikel/..." i.p.v. "https://nos.nl".
- Bronnen bij voorkeur: NOS, NU.nl, EO, CIP, Refoweb, Nederlands Dagblad, Reformatorisch Dagblad, YouTube/Vimeo.
- Geef bij ieder item een korte "summary" of "type".
- Voeg 2–4 items toe per categorie als er voldoende relevant is.

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
  }

  // bijbelstudie (default)
  return `${baseHeader}
Schema:
{
  "type":"bijbelstudie",
  "title":"string",
  "summary":"string",
  "central_passages":[
    {"ref":"Boek Hoofdstuk:Vers-...","text":"VOLLEDIGE TEKST","reason":"waarom centraal"},
    {"ref":"Boek Hoofdstuk:Vers-...","text":"VOLLEDIGE TEKST","reason":"waarom centraal"}
  ],
  "discussion":["vraag1","vraag2","vraag3"],
  "application":["toepassing1","toepassing2"],
  "prayer":"korte gebedstekst"
}

Vereisten:
- Lever precies 2 centrale gedeelten met VOLLEDIGE tekst (HSV of NKJV volgens context).
- "discussion" 3–5 vragen; "application" 2–4 concrete punten.
- "prayer" kort en pastoraal.

Context:
${typeof context === "string" ? context : JSON.stringify(context, null, 2)}

Extra:
${extra}`;
}

/* ===========================
   OpenRouter call
   =========================== */

async function callOpenRouter({ messages, stream = false }) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    // Optioneel helpt dit voor OpenRouter usage attribution:
    ...(process.env.SITE_URL ? { "HTTP-Referer": process.env.SITE_URL } : {}),
    ...(process.env.SITE_NAME ? { "X-Title": process.env.SITE_NAME } : {}),
  };
  const body = {
    model: OPENROUTER_MODEL,
    stream,
    messages,
  };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  return res;
}

/* ===========================
   Routes
   =========================== */

// JSON compose: altijd strikte JSON
router.post("/compose", async (req, res) => {
  try {
    const { mode = "bijbelstudie", context = {}, extra = "" } = req.body || {};
    const messages = [
      { role: "system", content: systemMessage(mode) },
      { role: "user", content: jsonPrompt(mode, context, extra) },
    ];
    const r = await callOpenRouter({ messages, stream: false });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || "";

    const parsed = safeJsonParse(raw);
    const finalJson = postProcessResult(mode, parsed);

    if (finalJson) {
      return res.json(finalJson);
    }
    // Fallback zodat AiResultCard iets kan tonen i.p.v. "dichtgeklapt"
    return res.json({ error: "bad_json", raw });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Streaming: altijd proza (geen JSON)
router.post("/compose/stream", async (req, res) => {
  try {
    const { mode = "bijbelstudie", context = {}, extra = "" } = req.body || {};
    const messages = [
      { role: "system", content: systemMessage(mode) },
      { role: "user", content: prosePrompt(mode, context, extra) },
    ];
    const r = await callOpenRouter({ messages, stream: true });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value).replace(/: ?OPENROUTER PROCESSING/gi, "");
      // We sturen de chunks door zoals ze komen (OpenRouter geeft al SSE)
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
