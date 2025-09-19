// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

const router = Router();

/** Prompt-builder (inhoudelijk gelijkwaardig; pas gerust aan je smaak aan) */
function buildPrompt({ mode, extra, context }) {
  const base = `
Je krijgt context uit favorieten/notities/grafieken (incl. "Boek-hits").
- Analyseer eerst en leid ZELF het centrale THEMA af.
- Schrijf helder Nederlands.
- Gebruik Markdown-koppen (##, ###) en korte bullets.
- Citeer Schrift spaarzaam (1–2 zinnen) en verwijs compact (bijv. "Rom. 8:1").
- Voeg altijd **Reikwijdte door de Bijbel** toe o.b.v. Boek-hits.
Extra instructies:
${extra || "-"}
===== CONTEXT (incl. Boek-hits onderaan) =====
${context}
`.trim();

  if (mode === "bijbelstudie") {
    return `
${base}

MAAK EEN **BIJBELSTUDIE-OPZET**:
- Thema (1 zin).
- Lezen: 3–6 tekstgedeelten met 1-zins duiding.
- Opzet (5 stappen).
- Gespreksvragen (6–10).
- Toepassing (3–5).
- **Reikwijdte door de Bijbel** (korte duiding Boek-hits).
`.trim();
  }

  if (mode === "preek") {
    return `
${base}

MAAK EEN **PREEK-OPZET**:
- Tekst & thema (1–2 zinnen).
- Kapstok (3–5 punten + subpunten).
- Christus centraal.
- Achtergrond (kort).
- Toepassing (3–5).
- **Reikwijdte door de Bijbel** (korte duiding Boek-hits).
`.trim();
  }

  // liederen / sing-in
  return `
${base}

MAAK EEN **LIEDEREN-OPZET** (Psalmen / Opwekking / Op Toonhoogte):
- 2–3 blokken: Aanbidding / Woord / Reactie.
- Per blok 3–5 liederen: "Collectie Nummer — korte motivatie".
- 2–3 korte schriftlezingen (waar passend).
- 1–2 zinnen verbindende tekst per blok.
- **Reikwijdte door de Bijbel** (korte duiding Boek-hits).
`.trim();
}

/** (optioneel gebruikt) */
function buildFindVersesPrompt({ limit, mode, context, extra }) {
  return `
Zoek ${limit} extra relevante bijbelverzen bij het afgeleide thema.
- Output: "Boek Hoofdstuk:Vers — 1 zin motivatie".
- Varieer OT/NT waar passend.
- Helder Nederlands.
Extra:
${extra || "-"}
===== CONTEXT =====
${context}
`.trim();
}

/** Synchroon compose */
router.post("/compose", async (req, res, next) => {
  try {
    let { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    // alias "sing-in" → "liederen" om beide te accepteren
    if (mode === "sing-in") mode = "liederen";

    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
    }
    const modelOverride = req.headers["x-model"];
    const temperature = mode === "liederen" ? 0.7 : 0.55;

    const { text, usage } = await callLLM({
      prompt: buildPrompt({ mode, extra, context }),
      model: modelOverride || undefined,
      temperature,
      max_tokens: 950,
    });

    res.json({ result: text, usage }); // <-- behoud {result} zoals in je werkende versie
  } catch (e) { next(e); }
});

/** Streaming (SSE) */
// VERVANG je huidige /compose/stream door dit:
router.post("/compose/stream", async (req, res) => {
  try {
    let { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (mode === "sing-in") mode = "liederen"; // alias, voor oude frontend
    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
    }

    const model = req.headers["x-model"] || process.env.OPENROUTER_MODEL || "openrouter/auto";
    const temperature = mode === "liederen" ? 0.7 : 0.55;
    const system =
      "Je bent een Nederlandstalige Bijbelstudie-assistent (HSV/NKJV). Wees nauwkeurig, Christus-centraal, pastoraal en praktisch.";

    // 1) SSE-headers naar de client
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    req.socket?.setKeepAlive?.(true);
    res.write(": ping\n\n"); // immediate feedback

    // 2) OpenRouter aanroepen met stream=true (let op Accept!)
    const orResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",                  // <— belangrijk voor stream
        "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:5173",
        "X-Title": "Bijbelzoek",
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        max_tokens: 950,
        messages: [
          { role: "system", content: system },
          { role: "user", content: buildPrompt({ mode, extra, context }) },
        ],
      }),
    });

    if (!orResp.ok || !orResp.body) {
      const raw = await orResp.text().catch(() => "");
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: `OpenRouter ${orResp.status}`, raw: raw.slice(0, 300) })}\n\n`);
      return res.end();
    }

    // 3) Upstream SSE lezen en delta-tekst doorsturen als data: "..."
    const reader = orResp.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";

    const flush = () => {
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const evt = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        for (const rawLine of evt.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            res.write(`event: end\n`);
            res.write(`data: {"done":true}\n\n`);
            res.end();
            return true;
          }
          // probeer JSON → pak delta tekst
          try {
            const j = JSON.parse(payload);
            const delta =
              j?.choices?.[0]?.delta?.content ??
              j?.choices?.[0]?.message?.content ??
              j?.choices?.[0]?.text ??
              "";
            if (delta) res.write(`data: ${JSON.stringify(String(delta))}\n\n`);
          } catch {
            // geen JSON (keep-alive/usage etc.) → negeren
          }
        }
      }
      return false;
    };

    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (flush()) return; // [DONE] gezien
      }
      // netjes afronden als upstream eindigt zonder [DONE]
      res.write(`event: end\n`);
      res.write(`data: {"done":true}\n\n`);
      res.end();
    })().catch((err) => {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    });
  } catch (e) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: e?.message || String(e) })}\n\n`);
    res.end();
  }
});



/** (optioneel) extra verzen – sync */
router.post("/find-verses", async (req, res, next) => {
  try {
    const { mode = "bijbelstudie", limit = 12, extra = "", context = "" } = req.body || {};
    const modelOverride = req.headers["x-model"];
    const { text, usage } = await callLLM({
      prompt: buildFindVersesPrompt({ limit, mode, context, extra }),
      model: modelOverride || undefined,
      temperature: 0.5,
      max_tokens: 900,
    });
    res.json({ result: text, usage });
  } catch (e) { next(e); }
});

/** (optioneel) extra verzen – stream (behoudt oud contract) */
router.post("/find-verses/stream", async (req, res) => {
  try {
    const { mode = "bijbelstudie", limit = 12, extra = "", context = "" } = req.body || {};
    const modelOverride = req.headers["x-model"];

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    await streamLLM({
      prompt: buildFindVersesPrompt({ limit, mode, context, extra }),
      model: modelOverride || undefined,
      temperature: 0.5,
      max_tokens: 900,
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
