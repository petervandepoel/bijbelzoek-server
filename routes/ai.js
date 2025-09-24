// server/routes/ai.js
import { Router } from "express";
const router = Router();

/* ===========================
   Helpers
   =========================== */

function ytSearchLink(title) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    title || ""
  )}`;
}

function newsSearchLink(title, source) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(
    title + " site:" + (source || "")
  )}`;
}

function isValidUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeJsonParse(raw) {
  if (!raw) return null;
  let txt = String(raw).trim();

  // haal code fences weg
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) txt = fence[1];

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

function postProcessResult(mode, parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;

  if (parsed.type === "liederen" && parsed.songs) {
    for (const cat of Object.keys(parsed.songs)) {
      parsed.songs[cat] = parsed.songs[cat].map((song) => {
        const title = song.title || "";
        return { ...song, url: ytSearchLink(title) };
      });
    }
  }

  if (parsed.type === "actueelmedia") {
    if (Array.isArray(parsed.news)) {
      parsed.news = parsed.news.map((n) => ({
        ...n,
        url:
          isValidUrl(n.url) && !/nos\.nl\/?$/i.test(n.url)
            ? n.url
            : newsSearchLink(n.title, n.source),
      }));
    }
    if (Array.isArray(parsed.media)) {
      parsed.media = parsed.media.map((m) => ({
        ...m,
        url: isValidUrl(m.url) ? m.url : ytSearchLink(m.title),
      }));
    }
  }

  return parsed;
}

/* ===========================
   System messages
   =========================== */

function systemMessage(mode) {
  switch (mode) {
    case "preek":
      return "Je bent een predikant-assistent. Geef een preekvoorbereiding in JSON en proza.";
    case "liederen":
      return "Je bent een muziek-assistent. Geef passende liederen, maar voeg geen fake links toe.";
    case "actueelmedia":
      return "Je bent een nieuws- en media-assistent. Geef nieuws en media met echte bronnen.";
    default:
      return "Je bent een bijbelstudie-assistent. Geef rijke studies in JSON en proza.";
  }
}

/* ===========================
   Prose prompts (stream)
   =========================== */

function prosePrompt(mode, context, extra = "") {
  if (mode === "preek") {
    return `Schrijf een PREek in goed leesbaar Nederlands met duidelijke kopjes. 
GEEN JSON, alleen proza.

Structuur:
## Titel & Inleiding
## Hoofdlijnen (3 punten)
## Achtergrond & Verbanden
## Speciaal voor de kinderen
## Toepassing
## Gebed
## Homiletische tips

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  if (mode === "liederen") {
    return `Schrijf een korte intro en lijst daarna passende liederen. 
GEEN JSON, alleen proza.

Structuur:
## Intro
## Psalmen
- Titel (Nummer)
## Opwekking
- Titel (Nummer)
## Op Toonhoogte
- Titel (Nummer)
## Overige
- Titel (klassiek/gospel)

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  if (mode === "actueelmedia") {
    return `Geef een analyse van relevant nieuws en media. 
GEEN JSON, alleen proza.

Structuur:
## Analyse
## Nieuws
- Titel — bron
## Media
- Titel — type/bron

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  // default: bijbelstudie
  return `Schrijf een BIJBELSTUDIE in goed leesbaar Nederlands.
GEEN JSON, alleen proza.

Structuur:
## Samenvatting
## Centraal gedeelte 1 (volledige tekst + uitleg)
## Centraal gedeelte 2 (volledige tekst + uitleg)
## Vragen
## Toepassing
## Gebed

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
}

/* ===========================
   JSON prompts (compose)
   =========================== */

function jsonPrompt(mode, context, extra = "") {
  const baseHeader =
    "Geef ALLEEN geldige JSON. Geen uitleg erbuiten. Gebruik exact deze velden.";

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

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  if (mode === "liederen") {
    return `${baseHeader}
Schema:
{
  "type":"liederen",
  "songs":{
    "psalms":[{"number":1,"title":"..."}],
    "opwekking":[{"number":599,"title":"..."}],
    "op_toonhoogte":[{"number":321,"title":"..."}],
    "others":[{"title":"...","composer":"..."}]
  }
}

⚠️ Voeg GEEN url’s toe; alleen titel/nummer/componist. 
De server voegt automatisch YouTube-zoeklinks toe.

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  if (mode === "actueelmedia") {
    return `${baseHeader}
Schema:
{
  "type":"actueelmedia",
  "news":[{"title":"...","source":"NOS|NU.nl|EO|CIP","summary":"1–2 zinnen"}],
  "media":[{"title":"...","type":"video|audio|image","source":"YouTube|Vimeo|EO"}]
}

⚠️ Voeg GEEN url’s toe; alleen titel+source. 
De server genereert zoeklinks of vult geldige urls in.

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
  }

  // default: bijbelstudie
  return `${baseHeader}
Schema:
{
  "type":"bijbelstudie",
  "title":"string",
  "summary":"string",
  "central_passages":[
    {"ref":"...","text":"VOLLEDIGE TEKST","reason":"..."},
    {"ref":"...","text":"VOLLEDIGE TEKST","reason":"..."}
  ],
  "discussion":["vraag1","vraag2","vraag3"],
  "application":["toepassing1","toepassing2"],
  "prayer":"string"
}

Context:
${JSON.stringify(context, null, 2)}
Extra:
${extra}`;
}

/* ===========================
   OpenRouter call
   =========================== */

 async function callOpenRouter({ messages, stream = false }) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "gpt-4.1";
  const OPENROUTER_API_BASE_URL = process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1";
  const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER || "http://localhost:5173";
  const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || "Bijbelzoek Local";
  if (!OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");
  const url = `${OPENROUTER_API_BASE_URL}/chat/completions`;
   const res = await fetch(url, {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": OPENROUTER_REFERER,
      "X-Title": OPENROUTER_TITLE,
     },
     body: JSON.stringify({ model: OPENROUTER_MODEL, stream, messages }),
   });
   return res;
 }

/* ===========================
   Routes
   =========================== */
router.get("/compose/health", (_req, res) => res.json({ ok: true }));

router.post("/compose", async (req, res) => {
  try {
    const { mode = "bijbelstudie", context = {}, extra = "" } = req.body || {};
    const messages = [
      { role: "system", content: systemMessage(mode) },
      { role: "user", content: jsonPrompt(mode, context, extra) },
    ];
    const r = await callOpenRouter({ messages });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || "";

    const parsed = safeJsonParse(raw);
    const finalJson = postProcessResult(mode, parsed);

    if (finalJson) return res.json(finalJson);
    return res.json({ error: "bad_json", raw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
