// server/routes/ai.js
import { Router } from "express";
const router = Router();

function systemMessage(mode) {
  switch (mode) {
    case "preek":
      return "Je bent een predikant-assistent. Geef een preekvoorbereiding in JSON.";
    case "liederen":
      return "Je bent een muziek-assistent. Geef passende liederen in JSON.";
    case "actueelmedia":
      return "Je bent een nieuws-assistent. Geef nieuws en media in JSON.";
    default:
      return "Je bent een bijbelstudie-assistent. Geef een studie in JSON.";
  }
}

function prosePrompt(mode, context, extra = "") {
  return `Schrijf een duidelijke ${mode} in goed leesbaar Nederlands, met kopjes en opsommingen.
Context:
${JSON.stringify(context, null, 2)}
Extra: ${extra}`;
}

function jsonPrompt(mode, context, extra = "") {
  let schema = "";
  if (mode === "preek")
    schema = `{
  "type":"preek",
  "title":"string",
  "summary":"string",
  "outline":["punt1","punt2","punt3"],
  "background":["string"],
  "application":["string"],
  "prayer":"string",
  "children_block":"string",
  "homiletical_tips":["string"]
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
  "title":"string",
  "summary":"string",
  "central_passages":[{"ref":"...","text":"VOLLEDIGE TEKST","reason":"..."}],
  "discussion":["string"],
  "application":["string"],
  "prayer":"string"
}`;
  return `Geef ALLEEN geldige JSON volgens dit schema. Gebruik exact deze veldnamen.
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
      res.write(chunk.replace(/: ?OPENROUTER PROCESSING/gi, "")); // schoonmaak
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
