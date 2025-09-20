// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

const router = Router();

function getSystem(mode) {
  return `
Je bent een Nederlandstalige assistent voor Bijbelstudie/Preek/Liederen (HSV/NKJV).
- Wees nauwkeurig, theologisch verantwoord, Christus-centraal en pastoraal.
- Verwijs compact naar Schrift (bijv. "Rom. 8:1").
- Gebruik géén verzonnen bronnen. Bij 'Actueel' geef je alleen aanknopingspunten (geen fake citaten).
`.trim();
}

function buildPrompt({ mode, extra, context }) {
  return `
Schrijf in helder Nederlands, met Markdown-koppen (##, ###) en bullets.
Extra instructies:
${extra || "-"}

===== CONTEXT =====
${context || "-"}
`.trim();
}

// ✅ NIEUW: simpele root endpoint (compatibel met jouw test: POST /api/ai)
router.post("/", async (req, res, next) => {
  try {
    const { prompt = "", mode = "bijbelstudie" } = req.body || {};
    const { text, usage } = await callLLM({
      system: getSystem(mode),
      prompt: prompt || buildPrompt({ mode }),
      max_tokens: 2000,
      temperature: 0.6,
    });
    res.json({ text, usage });
  } catch (e) { next(e); }
});

// Uitgebreide compose (bewaard)
router.post("/compose", async (req, res, next) => {
  try {
    let { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
    }
    const temperature = mode === "liederen" ? 0.7 : 0.55;

    const { text, usage } = await callLLM({
      system: getSystem(mode),
      prompt: buildPrompt({ mode, extra, context }),
      temperature,
      max_tokens: 5000,
    });

    res.json({ result: text, usage });
  } catch (e) { next(e); }
});

// Streaming (bewaard)
router.post("/compose/stream", async (req, res) => {
  try {
    let { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    await streamLLM({
      system: getSystem(mode),
      prompt: buildPrompt({ mode, extra, context }),
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

export default router;
