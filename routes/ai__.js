// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

export const router = Router();

/** Bouw de prompt. Geen 'subject' invoer: het thema wordt uit de context afgeleid. */
function buildPrompt({ mode, extra, context }) {
  const head =
`Je krijgt hieronder context uit favorieten en notities.
- Analyseer eerst die context (teksten, notities, grafiek-woorden).
- Leid zelf het centrale THEMA af.
- Gebruik expliciet de sectie "Boek-hits" (hits per bijbelboek) voor een onderdeel "Reikwijdte door de Bijbel": wat valt op qua spreiding?
- Gebruik helder Nederlands en Markdown-koppen (##) met korte bullets.
- Citeer verzen compact (bijv. "Rom. 8:1").`;

  if (mode === "bijbelstudie") {
    return `
${head}

MAAK EEN BIJBELSTUDIE-OPZET:
- Start met: "Je wilt een Bijbelstudie maken over …" (vul thema in).
- Geef een GLOBALE INDELING (agenda van de avond).
- Noem TYPISCHE TEKSTGEDEELTEN met 1-zins toelichting.
- Voeg 6–10 GESPREKSVRAGEN (O/I/A gemengd) toe.
- Voeg 3–5 PRAKTISCHE TOEPASSINGEN toe.
- Voeg een sectie **Reikwijdte door de Bijbel** toe met een korte duiding van de Boek-hits.

EXTRA INSTRUCTIES (optioneel):
${extra || "-"}

===== CONTEXT (inclusief Boek-hits helemaal onderaan) =====
${context}`.trim();
  }

  if (mode === "preek") {
    return `
${head}

MAAK EEN PREEK-OPZET:
- Titel en BIJBEHORENDE TEKST(EN) (korte verwijzingen).
- 3–5 HOOFDPUNTEN met subpunten.
- CHRISTUS-CENTRAAL: laat zien hoe het evangelie spreekt in dit thema.
- Korte ACHTERGROND (historisch/theologisch) waar relevant.
- 3–5 CONCRETE TOEPASSINGEN voor vandaag.
- Voeg een sectie **Reikwijdte door de Bijbel** toe met korte duiding van Boek-hits.

EXTRA INSTRUCTIES (optioneel):
${extra || "-"}

===== CONTEXT (inclusief Boek-hits helemaal onderaan) =====
${context}`.trim();
  }

  // sing-in
  return `
${head}

MAAK EEN SING-IN / SAMENZANG-OPZET:
- 8–14 LIEDEREN in 2–3 blokken (Aanbidding / Woord / Reactie), elk met 1 korte motivatie.
- Gebruik NL-collecties waar mogelijk (Opwekking, Psalmen, Sela, Johan de Heer).
- Voeg 2–3 SCHRIFTLEZINGEN of korte responsies toe.
- Geef per blok 1–2 zinnen verbindende tekst.
- Voeg een sectie **Reikwijdte door de Bijbel** toe met korte duiding van Boek-hits.

EXTRA INSTRUCTIES (optioneel):
${extra || "-"}

===== CONTEXT (inclusief Boek-hits helemaal onderaan) =====
${context}`.trim();
}

/** Extra verzen prompt */
function buildFindVersesPrompt({ limit, mode, context, extra }) {
  return `
Zoek ${limit} extra RELEVANTE BIJBELVERZEN op basis van onderstaande context (favorieten/notities/grafiek-woorden + Boek-hits).
- Output als bullets: "Boek Hoofdstuk:Vers — 1 zin motivatie".
- Variëer OT/NT indien passend.
- Houd rekening met het beoogde gebruik: ${mode} (bijbelstudie | preek | sing-in).
- Gebruik helder Nederlands.

EXTRA INSTRUCTIES:
${extra || "-"}

===== CONTEXT =====
${context}`.trim();
}

/** Synchroon (blijft) */
router.post("/compose", async (req, res, next) => {
  try {
    const { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (!["bijbelstudie", "preek", "sing-in"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|sing-in)" });
    }
    const modelOverride = req.headers["x-model"];
    const temperature = mode === "sing-in" ? 0.7 : 0.55;

    const { text, usage } = await callLLM({
      prompt: buildPrompt({ mode, extra, context }),
      model: modelOverride || undefined,
      temperature,
      max_tokens: 950,
    });

    res.json({ result: text, usage });
  } catch (e) { next(e); }
});

/** Streaming (SSE) */
router.post("/compose/stream", async (req, res, next) => {
  try {
    const { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (!["bijbelstudie", "preek", "sing-in"].includes(mode)) {
      res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|sing-in)" });
      return;
    }
    const modelOverride = req.headers["x-model"];
    const temperature = mode === "sing-in" ? 0.7 : 0.55;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await streamLLM({
      prompt: buildPrompt({ mode, extra, context }),
      model: modelOverride || undefined,
      temperature,
      max_tokens: 950,
      onDelta: (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`),
      onEnd: (meta) => {
        res.write(`event: end\n`);
        res.write(`data: ${JSON.stringify({ done: true, usage: meta?.usage })}\n\n`);
        res.end();
      },
    });
  } catch (e) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      res.end();
    } catch {}
  }
});

/** Vind extra verzen (synchroon) */
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

/** Vind extra verzen (stream) */
router.post("/find-verses/stream", async (req, res, next) => {
  try {
    const { mode = "bijbelstudie", limit = 12, extra = "", context = "" } = req.body || {};
    const modelOverride = req.headers["x-model"];
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await streamLLM({
      prompt: buildFindVersesPrompt({ limit, mode, context, extra }),
      model: modelOverride || undefined,
      temperature: 0.5,
      max_tokens: 900,
      onDelta: (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`),
      onEnd: (meta) => {
        res.write(`event: end\n`);
        res.write(`data: ${JSON.stringify({ done: true, usage: meta?.usage })}\n\n`);
        res.end();
      },
    });
  } catch (e) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      res.end();
    } catch {}
  }
});

export default router;
