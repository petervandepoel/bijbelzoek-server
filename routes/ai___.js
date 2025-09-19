// server/routes/ai.js
import { Router } from "express";
import { callLLM, streamLLM } from "../services/provider.js";

const router = Router();

/** Bouw de hoofdprompt – model schrijft nette Markdown met korte verzen (blockquote) */
function buildPrompt({ mode, extra, context }) {
  const base = `
Je krijgt context uit favorieten/notities/grafieken (incl. "Boek-hits").
- Analyseer eerst en leid ZELF het centrale THEMA af.
- Schrijf helder Nederlands.
- Gebruik Markdown-koppen (##, ###), korte bullets en waar je Schrift citeert: zet 1–2 zinnen in een blockquote (regel begint met '> ...').
- Noteer Schriftverwijzingen compact (bijv. "Rom. 8:1", "Joh. 3:16") in de tekst.
- Voeg altijd een sectie **Reikwijdte door de Bijbel** toe die de Boek-hits kort duidt (OT/NT balans, opvallende boeken).

Extra instructies (optioneel):
${extra || "-"}

===== CONTEXT (inclusief Boek-hits onderaan) =====
${context}
`.trim();

  if (mode === "bijbelstudie") {
    return `
${base}

MAAK EEN **BIJBELSTUDIE-OPZET** met deze structuur:

## Thema
- 1 korte zin die het thema vangt.

## Lezen
- 3–6 tekstgedeelten (bijv. "Rom. 8:1–4 — 1 zin duiding").

## Opzet (globaal)
1. Inleiding (korte opening)
2. Verkenning van de tekst(en)
3. Verdieping (sleutelvers/woorden)
4. Toepassing nu
5. Gebed

## Gespreksvragen (6–10)
- Mix open/interpretatie/toepassing.
- Kort geformuleerd.

## Toepassing (3–5)
- Concreet, doordeweeks.

## Reikwijdte door de Bijbel
- Korte duiding o.b.v. Boek-hits (wat valt op?).

(Verwerk verzen als korte blockquotes waar passend.)
`.trim();
  }

  if (mode === "preek") {
    return `
${base}

MAAK EEN **PREEK-OPZET** met deze structuur:

## Tekst & thema
- Hoofdtekst(en) + thematische zin.

## Kapstok (3–5 punten)
- Elk punt met 1–2 subpunten.
- Voeg 1–2 korte verzen toe als blockquote bij relevante punten.

## Christus centraal
- Hoe spreekt het evangelie in dit thema?

## Achtergrond
- Historisch/theologisch (kort waar relevant).

## Toepassing (3–5)
- Concreet voor vandaag.

## Reikwijdte door de Bijbel
- Korte duiding o.b.v. Boek-hits.
`.trim();
  }

  // liederen
  return `
${base}

MAAK EEN **LIEDEREN-OPZET** (Psalmen / Opwekking / Op Toonhoogte) met deze structuur:

## Blokken
- Aanbidding
- Woord
- Reactie

Geef per blok 3–5 liederen. Gebruik ALLEEN de volgende collecties:
- **Psalmen** (bijv. "Psalm 42")
- **Opwekking** (bijv. "Opwekking 595")
- **Op Toonhoogte** (bijv. "Op Toonhoogte 432")

Schrijf per lied:
- "Collectie Nummer — korte motivatie".
- Vermijd andere bronnen (Sela/JdH etc. NIET gebruiken).
- Voeg 2–3 korte schriftlezingen toe (blockquotes) waar passend.
- Eindig elk blok met 1–2 zinnen verbindende tekst.

## Reikwijdte door de Bijbel
- Korte duiding o.b.v. Boek-hits.
`.trim();
}

/** (optioneel) – bewaard voor later, maar je gebruikt nu geen afzonderlijke verzen-finder */
function buildFindVersesPrompt({ limit, mode, context, extra }) {
  return `
Zoek ${limit} extra relevante bijbelverzen bij het afgeleide thema uit de context.
- Output als bullets: "Boek Hoofdstuk:Vers — 1 zin motivatie".
- Varieer OT/NT indien passend.
- Gebruik helder Nederlands.

Extra instructies:
${extra || "-"}

===== CONTEXT =====
${context}
`.trim();
}

/** Synchroon compose (blijft beschikbaar) */
router.post("/compose", async (req, res, next) => {
  try {
    const { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
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

    res.json({ result: text, usage });
  } catch (e) { next(e); }
});

/** Streaming (SSE) – gebruikt door Favorites.jsx */
router.post("/compose/stream", async (req, res) => {
  try {
    const { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
      return;
    }
    const modelOverride = req.headers["x-model"];
    const temperature = mode === "liederen" ? 0.7 : 0.55;

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

/** Vind extra verzen (synchroon) – optioneel te behouden */
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

/** Vind extra verzen (stream) – optioneel te behouden */
router.post("/find-verses/stream", async (req, res) => {
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
