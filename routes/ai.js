// server/routes/ai.js
import { Router } from "express";
const router = Router();

function systemMessage(mode) {
  switch (mode) {
    case "preek":
      return "Je bent een Nederlandstalige predikant-assistent. Geef een preekvoorbereiding met duidelijke structuur en JSON-output.";
    case "liederen":
      return "Je bent een muziek-assistent. Geef passende liederen in JSON-output.";
    case "actueelmedia":
      return "Je bent een assistent die nieuws en media verbindt met Bijbelstudie en preekvoorbereiding. Geef JSON-output met news en media velden.";
    default:
      return "Je bent een bijbelstudie-assistent. Geef JSON-output voor een groeps- of persoonlijke studie.";
  }
}

function prosePrompt(mode, context, extra = "") {
  return `Schrijf een duidelijke ${mode} in goed leesbaar Nederlands. Gebruik kopjes en opsommingen.
Context:
${JSON.stringify(context, null, 2)}
Extra: ${extra}`;
}

function jsonPrompt(mode, context, extra = "") {
  let schema = "";
  if (mode === "preek")
    schema = `{
  "type":"preek","title":"string","summary":"string",
  "outline":["punt1","punt2","punt3"],
  "background":["notities"],
  "application":["toepassing"],
  "prayer":"tekst",
  "children_block":"tekst",
  "homiletical_tips":["tip"]
}`;
  else if (mode === "liederen")
    schema = `{
  "type":"liederen",
  "songs":{
    "psalms":[{"number":1,"title":"...","url":"..."}],
    "opwekking":[{"number":599,"title":"...","url":"..."}],
    "op_toonhoogte":[{"number":123,"title":"...","url":"..."}],
    "others":[{"title":"...","composer":"...","url":"..."}]
  }
}`;
  else if (mode === "actueelmedia")
    schema = `{
  "type":"actueelmedia",
  "news":[{"title":"...","url":"...","source":"...","summary":"..."}],
  "media":[{"title":"...","url":"...","type":"video","source":"YouTube"}]
}`;
  else
    schema = `{
  "type":"bijbelstudie",
  "title":"...","summary":"...",
  "central_passages":[{"ref":"...","text":"VOLLEDIGE TEKST","reason":"..."}],
  "discussion":["vraag1","vraag2"],
  "application":["toepassing"],
  "prayer":"..."
}`;
  return `Geef ALLEEN geldige JSON volgens dit schema. Geen uitleg buiten JSON.
Schema: ${schema}
Context: ${JSON.stringify(context, null, 2)}
Extra: ${extra}`;
}

async function callOpenRouter({ messages, stream = false }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({ model: "gpt-4.1", stream, messages }),
  });
  return res;
}

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
    const parsed = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    res.json(parsed || { error: "bad_json", raw });
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
