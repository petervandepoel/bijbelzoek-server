// server/routes/ai.js
import { Router } from "express";

const router = Router();

// -------- Helpers --------
function systemMessage(mode) {
  switch(mode){
    case "preek":
      return "Je bent een Nederlandstalige predikant-assistent. Help om preekvoorbereiding theologisch verantwoord, Christus-centraal, pastoraal en praktisch te maken.";
    case "liederen":
      return "Je bent een Nederlandstalige muziek-assistent. Help bij het vinden van passende liederen bij bijbelgedeelten en thema's (Psalmen, Opwekking, Op Toonhoogte en andere).";
    case "actueelmedia":
      return "Je bent een Nederlandstalige assistent die nieuws en media verbindt met Bijbelstudie en preekvoorbereiding. Geef relevante artikelen, blogs, beelden en video's met compacte samenvatting en deeplinks.";
    default:
      return "Je bent een Nederlandstalige bijbelstudie-assistent. Help een groeps- of persoonlijke studie te maken die nauwkeurig, theologisch verantwoord en pastoraal is.";
  }
}

/* -------- Prose (streaming) prompts per blok -------- */
function prosePrompt(mode, context, extra = "") {
  switch(mode){
    case "preek":
      return `Schrijf een Nederlandse preekopzet met de volgende structuur:
- Titel en korte inleiding
- Driedelige hoofdlijnen (## Punt 1, ## Punt 2, ## Punt 3)
- Achtergrond en verbanden (taalkundig, historisch, theologisch)
- ## Speciaal voor de kinderen: eenvoudige uitleg of voorbeeld
- Praktische toepassingen
- Gebed

Gebruik duidelijke kopjes, bullets en compacte verwijzingen naar Schrift (bv. Rom. 8:1).
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    case "liederen":
      return `Geef een overzicht van liederen die passen bij dit thema, in nette secties:
## Psalmen
- Nummer, titel, link naar tekst of uitvoering

## Opwekking
- Nummer, titel, link

## Op Toonhoogte
- Nummer, titel, link

## Overige (klassiek/gospel/YouTube)
- Titel, componist (indien bekend), link

CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    case "actueelmedia":
      return `Zoek en beschrijf actuele artikelen, christelijke blogs en media rond dit thema. 
Voor elk item: geef 1–2 zinnen duiding en een directe deeplink.

## Nieuws
- Titel (bron) — samenvatting (1-2 zinnen). Link.

## Media
- Titel (YouTube/Wikimedia) — korte duiding. Link.

CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    default: // bijbelstudie
      return `Schrijf een Nederlandse bijbelstudie-opzet met de volgende structuur:
- Samenvatting context
- ## Centrale gedeelten (2 stuks, schrijf de volledige tekst uit en geef reden waarom centraal)
- Gespreksvragen (3-4)
- Praktische toepassingen
- Gebed

Gebruik duidelijke kopjes, bullets en compacte verwijzingen naar Schrift (bv. Rom. 8:1).
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;
  }
}

/* -------- JSON (compose) prompts per blok -------- */
function jsonPrompt(mode, context, extra = "") {
  switch(mode){
    case "preek":
      return `Maak een JSON-resultaat voor een preekvoorbereiding. Houd je 100% aan dit schema, geen tekst buiten JSON:
{
  "type": "preek",
  "title": "string",
  "summary": "string",
  "outline": ["punt1","punt2","punt3"],
  "background": ["historische/taalkundige/theologische notities"],
  "application": ["praktische toepassing"],
  "prayer": "gebedstekst",
  "children_block": "eenvoudige uitleg of voorbeeld voor kinderen",
  "homiletical_tips": ["beeldspraak","retorische suggesties"]
}
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    case "liederen":
      return `Maak een JSON-resultaat voor passende liederen. Houd je 100% aan dit schema:
{
  "type": "liederen",
  "songs": {
    "psalms": [ { "number": 23, "title": "De HEER is mijn herder", "url": "https://..." } ],
    "opwekking": [ { "number": 599, "title": "Tienduizend redenen", "url": "https://..." } ],
    "op_toonhoogte": [ { "number": 123, "title": "Titel", "url": "https://..." } ],
    "others": [ { "title": "Bach BWV 147", "composer": "Johann Sebastian Bach", "url": "https://..." } ]
  }
}
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    case "actueelmedia":
      return `Maak een JSON-resultaat voor actuele artikelen en media. Houd je 100% aan dit schema:
{
  "type": "actueelmedia",
  "news": [ { "title": "Artikel", "url": "https://...", "source": "NOS", "summary": "1-2 zinnen samenvatting" } ],
  "media": [ { "title": "YouTube video", "url": "https://...", "type": "video", "source": "YouTube" } ]
}
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;

    default: // bijbelstudie
      return `Maak een JSON-resultaat voor een bijbelstudie. Houd je 100% aan dit schema:
{
  "type": "bijbelstudie",
  "title": "string",
  "summary": "string",
  "central_passages": [
    { "ref": "Rom. 8:1-11", "text": "VOLLEDIGE TEKST", "reason": "waarom centraal" },
    { "ref": "Jes. 53:1-12", "text": "VOLLEDIGE TEKST", "reason": "waarom centraal" }
  ],
  "discussion": ["vraag1","vraag2","vraag3"],
  "application": ["toepassing1","toepassing2"],
  "prayer": "gebedstekst"
}
CONTEXT:
${JSON.stringify(context, null, 2)}
EXTRA:
${extra||"-"}`;
  }
}

// -------- OpenRouter API --------
async function callOpenRouter({ messages, stream = false }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      stream,
      messages,
    }),
  });
  return res;
}

// -------- Routes --------

// Structured JSON
router.post("/compose", async (req, res) => {
  try {
    const { mode = "bijbelstudie", context = {}, extra = "" } = req.body || {};
    const messages = [
      { role: "system", content: systemMessage(mode) },
      { role: "user", content: jsonPrompt(mode, context, extra) }
    ];
    const r = await callOpenRouter({ messages, stream: false });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    res.json(parsed || { error: "bad_json", raw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Streaming proza
router.post("/compose/stream", async (req, res) => {
  try {
    const { mode = "bijbelstudie", context = {}, extra = "" } = req.body || {};
    const messages = [
      { role: "system", content: systemMessage(mode) },
      { role: "user", content: prosePrompt(mode, context, extra) }
    ];
    const r = await callOpenRouter({ messages, stream: true });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders?.();

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
