// server/routes/ai.js
import { Router } from "express";

const router = Router();

// -------- Helpers --------
function systemMessage(mode) {
  return `
Je bent een Nederlandstalige assistent voor Bijbelstudie, Preek, Liederen en Actueel & Media.
- Wees nauwkeurig, theologisch verantwoord, Christus-centraal en pastoraal.
- Verwijs compact naar Schrift (bv. Rom. 8:1).
- Geen verzonnen bronnen/urls. Bij externe verwijzingen: alleen echte, controleerbare info.
`.trim();
}

function prosePrompt(mode, context, extra = "") {
  const label =
    mode === "preek" ? "Preek" :
    mode === "liederen" ? "Liederen" :
    mode === "actueelmedia" ? "Actueel & Media" :
    "Bijbelstudie";

  return `
Schrijf in het Nederlands een goed leesbare ${label}-opzet op basis van de CONTEXT.
- Begin met een korte analyse van de context.
- Gebruik duidelijke kopjes (##), lijstjes (•) en compacte verwijzingen (Rom. 8:1).
- Voeg toepassing en evt. gebedspunten toe.
- GEEN JSON – alleen proza.

CONTEXT:
${JSON.stringify(context, null, 2)}

EXTRA:
${extra || "-"}
`.trim();
}

function jsonPrompt(mode, context, extra = "") {
  return `
Maak een rijk resultaat voor ${mode}. Output uitsluitend JSON volgens dit schema:

{
  "type": "${mode}",
  "title": "string",
  "summary": "string",
  "central_passages": [ { "ref": "Rom. 8:1-11", "reason": "..." } ],
  "outline": ["kop 1", "kop 2"],
  "background": ["historische notitie ..."],
  "application": ["toepassing 1"],
  "prayer": "gebedstekst",
  "songs": [
    { "title": "Tienduizend redenen", "source": "Opwekking 599", "url": "https://..." }
  ],
  "news": [],
  "media": []
}

CONTEXT:
${JSON.stringify(context, null, 2)}

EXTRA:
${extra || "-"}
`.trim();
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
    // Probeer message content te parsen
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
      // Doorsturen zoals het komt
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// TODO: actueel & media endpoints blijven zoals je oude bestand (`/actueel-media`, `/actueel`, `/media`)

export default router;
