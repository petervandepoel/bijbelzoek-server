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
- Als de CONTEXT 'Algemene notities' en/of expliciete vragen bevat: identificeer ze en verwerk ze in de structuur (met name bij Gespreksvragen/Toepassing).
`.trim();
}

/** Prompt-builder (inhoudelijk gelijkwaardig; pas gerust aan je smaak aan) */
function buildPrompt({ mode, extra, context }) {
  // De CONTEXT kan favorieten / grafieken / bijbelteksten / ALGEMENE NOTITIES bevatten.
  // We laten de LLM zélf de structuur afleiden, maar sturen strak op de output-secties.
  const base = `
Je krijgt CONTEXT uit favorieten, notities (inclusief ALGEMENE NOTITIES met evt. VRAGEN), grafieken (incl. "Boek-hits").
Taken:
1) Analyseer eerst de CONTEXT en leid ZELF één kern-thema af (noem dit expliciet).
2) Herken expliciete vragen uit (Algemene) notities en verwerk die in Gespreksvragen/Toepassing.
3) Houd rekening met "Boek-hits" bij 'Reikwijdte door de Bijbel'.

Schrijf helder Nederlands, met Markdown-koppen (##, ###) en korte bullets.
Citeer Schrift spaarzaam (1–2 zinnen max.), verwijs compact (bijv. "Rom. 8:1").

Extra instructies van de gebruiker:
${extra || "-"}

===== CONTEXT (incl. Boek-hits en notities/vragen) =====
${context}
`.trim();

  if (mode === "bijbelstudie") {
    return `
${base}

LEVER EEN **BIJBELSTUDIE** MET DEZE SECTIES:

## Thema
- Eén zin.

## Centrale lezingen (2 sets)
- **Set A – Kerntekst(en):** 1–2 hoofddelen (bijv. "Joh. 3:1–16" + "Num. 21:4–9"), kort waarom.
- **Set B – Kerntekst(en):** 1–2 andere hoofddelen, kort waarom.
- **Aanvullend meelezen:** 2–4 referenties, alleen verwijzingen.

## Achtergrond & inzichten
- Historische/culturele context, sleutelbegrippen (Hebreeuws/Grieks waar zinvol), literaire structuur.
- Wat leert dit voor een ervaren lezer? 3–5 puntsgewijze inzichten.

## Opzet (5 stappen)
- Korte, logische opbouw per stap, gericht op samen Bijbel lezen.

## Gespreksvragen (6–10)
- Concreet, vanuit de CONTEXT én eventuele vragen in notities.

## Toepassing (3–5)
- Praktisch en pastorale toepassing, sluit aan op gestelde vragen/omstandigheden.

## Reikwijdte door de Bijbel
- 4–8 verbanden over OT/NT o.b.v. Boek-hits (alleen verwijzingen + 1 korte duiding).

## Actueel
- 1–3 actuele aanknopingspunten (kranten/studies/nieuws). 
- Gebruik géén verzonnen bronnen; formuleer algemeen (bijv. “recente studie over X”).
`.trim();
  }

  if (mode === "preek") {
    return `
${base}

LEVER EEN **PREEK-OPZET** MET DEZE SECTIES:

## Tekst & thema
- 1–2 zinnen (verwijs compact).

## Centrale lezingen (2 sets)
- **Set A – Kerntekst(en):** 1–2 hoofddelen, kort waarom.
- **Set B – Kerntekst(en):** 1–2 hoofddelen, kort waarom.
- **Aanvullend meelezen:** 2–4 referenties, alleen verwijzingen.

## Achtergrond & inzichten
- Historie, context, sleutelbegrippen, retoriek/structuur; 3–6 punten, voor de ervaren hoorder.

## Kapstok (3–5 punten)
- Met subpunten (korte bullets). Christus centraal.

## Toepassing (3–5)
- Concreet, pastorale toepassing, verbind met vragen uit notities.

## Reikwijdte door de Bijbel
- 4–8 verbanden OT/NT o.b.v. Boek-hits (korte duiding).

## Actueel
- 1–3 actuele aanknopingspunten. Geen verzonnen bronnen; algemeen formuleren.
`.trim();
  }

  // LIEDEREN
  return `
${base}

LEVER EEN **LIEDEREN-SELECTIE** GEGROEPEERD (géén lange tekst, alleen titel/nummer + korte motivatie):

## Psalmen
- 3–6 regels in de vorm: "**Psalm <nummer> — <titel>** — <korte motivatie (max 12 woorden)>"

## Opwekking
- 3–6 regels in de vorm: "**Opwekking <nummer> — <titel>** — <korte motivatie (max 12 woorden)>"

## Op Toonhoogte
- 3–6 regels in de vorm: "**Op Toonhoogte <nummer> — <titel>** — <korte motivatie (max 12 woorden)>"

## Actueel
- 1–2 korte aanknopingspunten (optioneel) die de selectie onderbouwen (zonder bronverzinsels).
`.trim();
}


/** (optioneel gebruikt) */
function buildFindVersesPrompt({ limit, mode, context, extra }) {
  return `
Identificeer het kern-thema uit de CONTEXT en geef ${limit} aanvullende Bijbelverwijzingen
(afwisselend OT/NT indien passend) die dit thema verdiepen.

Output per regel:
"Boek Hoofdstuk:Vers — 1 zins motivatie (max 14 woorden)"

Gebruik géén lange citaten; alleen verwijzing + mini-duiding.
Verwerk expliciete vragen uit (Algemene) notities waar relevant.

Extra instructies:
${extra || "-"}

===== CONTEXT =====
${context}
`.trim();
}


/** Synchroon compose */
router.post("/compose", async (req, res, next) => {
  try {
    let { mode = "bijbelstudie", extra = "", context = "" } = req.body || {};
    if (mode === "sing-in") mode = "liederen";
    if (!["bijbelstudie", "preek", "liederen"].includes(mode)) {
      return res.status(400).json({ error: "Ongeldige mode (bijbelstudie|preek|liederen)" });
    }
    const modelOverride = req.headers["x-model"];
    const temperature = mode === "liederen" ? 0.7 : 0.55;

    const { text, usage } = await callLLM({
      system: getSystem(mode),
      prompt: buildPrompt({ mode, extra, context }),
      model: modelOverride || undefined,
      temperature,
      max_tokens: 5000,  // iets meer ruimte voor 'Achtergrond' + 'Actueel'
    });

    res.json({ result: text, usage });
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
    const system = getSystem(mode);


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
        max_tokens: 5000,
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
