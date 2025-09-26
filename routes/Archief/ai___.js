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
  const base =
    "Schrijf in helder Nederlands met je/jij. Toon: breed interkerkelijk; strikt met bronnen (liever kort dan speculeren). Gebruik HSV als standaard. Citeer Schriftverwijzingen voluit en schrijf de verzen uit in HSV. Contextprioriteit: 1) Algemene notities (belangrijkst), 2) 📊 Grafieken (zoekwoorden), 3) ⭐ Favoriete teksten. Respecteer Metadata (Bijbelversie, Zoekmodus). Lengte-indicatie voor proza: ~600–900 woorden. Als Algemene notities, 📊 Grafieken én ⭐ Favoriete teksten allemaal ontbreken: genereer geen inhoud; leg kort uit welke input nodig is en stop.";

  switch (mode) {
    case "preek":
      return base + " Jij bent een predikant-assistent voor een traditionele gemeente. Lever pastorale, praktische en theologisch zorgvuldige inhoud met rijke maar relevante kruisverwijzingen.";
    case "liederen":
      return base + " Jij bent een muziek-/liturgie-assistent; je suggereert passende liederen per bundel met korte motivatie per lied. Geen directe URL’s.";
    case "actueelmedia":
      return base + " Jij bent een nieuws- en media-assistent; duid recente ontwikkelingen en media rond het thema met nuance én duidelijke kern; gebruik bron+titel en veilige zoekopdrachten in plaats van directe URL’s.";
    default:
      return base + " Jij bent een bijbelstudie-assistent; maak een compacte maar rijke studie met centrale gedeelten, hoofdlijnen en toepassing.";
  }
}


/* ===========================
   Prose prompts (stream)
   =========================== */

function prosePrompt(mode, context, extra = "") {
  const common =
    "Gebruik de aangeleverde Context (Markdown/JSON) actief. Verwerk expliciet: (1) Algemene notities (belangrijkst), (2) 📊 Grafieken (zoekwoorden), (3) ⭐ Favoriete teksten. Gebruik HSV; schrijf bijbelteksten altijd volledig uit bij verwijzingen. Schrijf compact maar inhoudelijk. Als alle genoemde context-secties ontbreken: schrijf één korte melding dat er meer input nodig is en STOP — voeg dan GEEN JSON toe.";

  if (mode === "preek") {
    return `Schrijf een preekvoorbereiding (traditionele gemeente).
GEEN JSON bovenin; alleen proza met exact deze koppen (voor de UI):

## Contextanalyse
## Titel & Inleiding
## Hoofdlijnen (3 punten)
- Punt 1 — + 1 illustratie
- Punt 2 — + 1 illustratie
- Punt 3 — + 1 illustratie
## Achtergrond & Verbanden
## Speciaal voor de kinderen (alleen indien de context daarom vraagt)
## Toepassing
## Homiletische tips

Richtlijnen:
- Rijke maar relevante kruisverwijzingen; schrijf bijbelteksten volledig uit (HSV).
- Toon: breed interkerkelijk; strikt met bronnen (liever kort dan speculeren).
- Lengte: ~600–900 woorden.
- Geen gebed opnemen.
- Ná het proza: voeg EENMALIG een geldige \`\`\`json codefence\`\`\` toe met kaartdata volgens schema hieronder.

${common}

Context:
${JSON.stringify(context, null, 2)}

Extra wensen:
${extra}

Voeg ONDERAAN toe als \`\`\`json\`\`\`:

{
  "type":"preek",
  "title":"<korte titel>",
  "summary":"<2–4 zinnen samenvatting>",
  "outline":[
    {"kop":"Hoofdlijnen (3 punten)","opsomming":["Punt 1","Punt 2","Punt 3"]},
    {"kop":"Achtergrond & Verbanden","inhoud":["…","…"]},
    {"kop":"Toepassing","inhoud":["…","…"]}
  ],
  "background":["contextpunt","historische of tekstuele notitie"],
  "children_block":"<alleen opnemen indien van toepassing, anders weglaten>",
  "homiletical_tips":["Korte alinea met 3–5 zinnen als één item"],
  "application":["toepassing 1","toepassing 2"]
}`;
  }

  if (mode === "liederen") {
    return `Schrijf een korte intro en geef daarna passende liederen per bundel.
GEEN JSON bovenin; alleen proza met deze koppen:

## Intro
## Psalmen
- <Nummer> — <Titel>: <1–2 zinnen motivatie>
## Opwekking
- <Nummer> — <Titel>: <1–2 zinnen motivatie>
## Op Toonhoogte
- <Nummer> — <Titel>: <1–2 zinnen motivatie>
## Liedboek 2013
- <Nummer> — <Titel>: <1–2 zinnen motivatie>
## Overige
- <Titel> (NL/EN): <1–2 zinnen motivatie>

Richtlijnen:
- 8–12 suggesties totaal.
- NL/EN gemengd toegestaan bij “Overige”.
- Geen directe URL’s; titels/nummers volstaan.
- Koppel motivatie expliciet aan thema/teksten uit de Context.
- Ná het proza: voeg EENMALIG een \`\`\`json\`\`\`-blok toe voor de kaart.

${common}

Context:
${JSON.stringify(context, null, 2)}

Extra wensen:
${extra}

Voeg ONDERAAN toe als \`\`\`json\`\`\`:

{
  "type":"liederen",
  "title":"Liederen bij <thema>",
  "summary":"<1–2 zinnen over de selectie>",
  "outline":[{"kop":"Motivatie per bundel","inhoud":["…","…"]}],
  "songs":{
    "psalms":[{"number":0,"title":"…","note":"1–2 zinnen"}],
    "opwekking":[{"number":0,"title":"…","note":"1–2 zinnen"}],
    "op_toonhoogte":[{"number":0,"title":"…","note":"1–2 zinnen"}],
    "liedboek":[{"number":0,"title":"…","note":"1–2 zinnen"}],
    "others":[{"title":"…","note":"1–2 zinnen"}]
  }
}`;
  }

  if (mode === "actueelmedia") {
    return `Geef een compacte duiding van relevante ontwikkelingen en content rond het thema.
GEEN JSON bovenin; alleen proza met deze koppen:

## Analyse
## Nieuws
- <Titel> — <Bron> (datum indien recent): <1–2 zinnen samenvatting>
## Media
- <Titel> — <type/bron>: <1–2 zinnen waarom relevant>

Richtlijnen:
- 8–12 items totaal (nieuws + media samen).
- Gebruik bron+titel en veilige zoekopdrachten in plaats van directe URL’s:
  - Nieuws: https://duckduckgo.com/?q=<Titel> site:<Bron>
  - Media: https://www.youtube.com/results?search_query=<Titel>
- Koppeling met thema/teksten per item is optioneel; nuance + duidelijke kern.
- Datum alleen tonen als het recent is.
- Ná het proza: voeg EENMALIG een \`\`\`json\`\`\`-blok toe.

${common}

Context:
${JSON.stringify(context, null, 2)}

Extra wensen:
${extra}

Voeg ONDERAAN toe als \`\`\`json\`\`\`:

{
  "type":"actueelmedia",
  "title":"Actueel & Media bij <thema>",
  "summary":"<2–4 zinnen duiding>",
  "news":[
    {"title":"…","source":"NOS|NU.nl|EO|CIP|Reformatorisch Dagblad","summary":"1–2 zinnen","date":"<optioneel>","url":"https://duckduckgo.com/?q=<titel>%20site:<bron>"}
  ],
  "media":[
    {"title":"…","type":"video|audio|image","source":"YouTube|EO|Vimeo","url":"https://www.youtube.com/results?search_query=<titel>"}
  ]
}`;
  }

  // default: bijbelstudie
  return `Schrijf een compacte maar rijke bijbelstudie.
GEEN JSON bovenin; alleen proza met exact deze koppen:

## Contextanalyse
## Titel & Inleiding
## Centrale gedeelten
- <Ref 1 (HSV) — VOLLEDIGE TEKST>
  Uitleg: …
- <Ref 2 (HSV) — VOLLEDIGE TEKST> (optioneel)
  Uitleg: …
- <Ref 3 (HSV) — VOLLEDIGE TEKST> (optioneel)
  Uitleg: …
## Hoofdlijnen (3 punten)
- …
- …
- …
## Achtergrond & Verbanden
## Toepassing
## Gespreksvragen (5–7)
- …

Richtlijnen:
- Aantal centrale gedeelten flexibel (1–3), met volledige HSV-tekst.
- Andere verwijzingen: volledige tekst of parafrase met exacte ref; kies beknopt maar accuraat.
- Verwerk expliciet ‘Algemene notities’ en de zoekwoorden uit ‘📊 Grafieken’.
- Geen gebed opnemen.
- Ná het proza: voeg EENMALIG een \`\`\`json\`\`\`-blok toe voor de kaart.

${common}

Context:
${JSON.stringify(context, null, 2)}

Extra wensen:
${extra}

Voeg ONDERAAN toe als \`\`\`json\`\`\`:

{
  "type":"bijbelstudie",
  "title":"<korte titel>",
  "summary":"<2–4 zinnen samenvatting>",
  "outline":[
    {"kop":"Contextanalyse","inhoud":["…","…"]},
    {"kop":"Hoofdlijnen (3 punten)","opsomming":["…","…","…"]},
    {"kop":"Achtergrond & Verbanden","inhoud":["…","…"]},
    {"kop":"Toepassing","inhoud":["…","…"]}
  ],
  "central_passages":[
    {"ref":"Boek X:Y-Z","text":"VOLLEDIGE HSV-tekst","reason":"waarom centraal"}
  ],
  "discussion":["vraag 1","vraag 2","vraag 3","vraag 4","vraag 5"]
}`;
}


/* ===========================
   JSON prompts (compose)
   =========================== */

function jsonPrompt(mode, context, extra = "") {
  const baseHeader =
    "Geef ALLEEN geldige JSON. Geen uitleg erbuiten. Gebruik exact deze velden. Gebruik HSV en schrijf bijbelverzen volledig uit waar van toepassing. Respecteer: 1) Algemene notities, 2) 📊 Grafieken, 3) ⭐ Favoriete teksten. Als alle contextsecties ontbreken: geef JSON met {\"error\":\"no_context\",\"message\":\"Meer input nodig\"}.";

  if (mode === "preek") {
    return `${baseHeader}
Schema:
{
  "type":"preek",
  "title":"string",
  "summary":"string",
  "outline":[
    {"kop":"Hoofdlijnen (3 punten)","opsomming":["Punt 1","Punt 2","Punt 3"]},
    {"kop":"Achtergrond & Verbanden","inhoud":["…","…"]},
    {"kop":"Toepassing","inhoud":["…","…"]}
  ],
  "background":["string"],
  "children_block":"string (optioneel)",
  "homiletical_tips":["één item met korte alinea als string"],
  "application":["string"]
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
  "title":"string",
  "summary":"string",
  "outline":[{"kop":"Motivatie per bundel","inhoud":["…","…"]}],
  "songs":{
    "psalms":[{"number":0,"title":"string","note":"string"}],
    "opwekking":[{"number":0,"title":"string","note":"string"}],
    "op_toonhoogte":[{"number":0,"title":"string","note":"string"}],
    "liedboek":[{"number":0,"title":"string","note":"string"}],
    "others":[{"title":"string","note":"string"}]
  }
}

⚠️ Geen directe URL’s; de server voegt veilige zoeklinks toe.

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
  "title":"string",
  "summary":"string",
  "news":[{"title":"string","source":"string","summary":"string","date":"string (optioneel)","url":"string"}],
  "media":[{"title":"string","type":"video|audio|image","source":"string","url":"string"}]
}

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
  "outline":[
    {"kop":"Contextanalyse","inhoud":["…","…"]},
    {"kop":"Hoofdlijnen (3 punten)","opsomming":["…","…","…"]},
    {"kop":"Achtergrond & Verbanden","inhoud":["…","…"]},
    {"kop":"Toepassing","inhoud":["…","…"]}
  ],
  "central_passages":[{"ref":"string","text":"VOLLEDIGE HSV-tekst","reason":"string"}],
  "discussion":["string"]
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
