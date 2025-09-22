// server/services/provider.js
import "dotenv/config";

const OR_URL   = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
const OR_MODEL = process.env.OPENROUTER_MODEL    || "openrouter/auto";
const OR_KEY   = process.env.OPENROUTER_API_KEY  || "";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function ensureKey() {
  if (process.env.MOCK_LLM === "1") return;
  if (!OR_KEY) {
    const err = new Error("Missing OPENROUTER_API_KEY");
    err.status = 401;
    err.code = "missing_api_key";
    throw err;
  }
}

function buildBody({ system, prompt, model, temperature, max_tokens, top_p }) {
  return {
    model: model || OR_MODEL,
    temperature: temperature ?? 0.55,
    ...(top_p ? { top_p } : {}),
    max_tokens: clamp(max_tokens ?? 3000, 128, 8000),
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
  };
}

/* =============== Non-stream =============== */
export async function callLLM({ system, prompt, model, temperature, top_p, max_tokens } = {}) {
  if (process.env.MOCK_LLM === "1") {
    const s = {
      type: "bijbelstudie",
      title: "Geloof & Genade — verkenning (mock)",
      context: {
        summary: "Samenvatting van notities, favorieten en grafiekwoorden.",
        insights: ["Geloof rechtvaardigt, niet werken.", "Genade is onverdiend, maar kostbaar."],
        answered_questions: ["Wat is rechtvaardiging?", "Relatie geloof ↔ werken?"]
      },
      verses: [{ ref: "Rom. 3:21-26", text: "…" }],
      central_passages: [
        { ref: "Rom. 5:1-11", reason: "Kern van verzoening en vrede met God" },
        { ref: "Ef. 2:1-10", reason: "Uit genade door geloof, niet uit werken" }
      ],
      summary: "Korte inleiding bij het thema.",
      outline: ["Schepping → zonde → Christus", "Rechtvaardiging", "Leven uit de Geest"],
      background: ["Romeinen-brief: context Paulus", "Genade in Ef. 2"],
      discussion: ["Welke rol speelt geloof in jouw dagelijks leven?"],
      application: ["Dankbaarheid vormt levensstijl", "Oefen vertrouwen in gebed"],
      prayer: "Heer, leer ons rusten in Uw genade en leven door geloof.",
      songs: {
        "Psalmen": [{ number: 23, title: "De HEER is mijn Herder" }],
        "Opwekking": [{ number: 599, title: "Tienduizend redenen" }],
        "Op Toonhoogte": [{ number: 123, title: "Uw genade is mij genoeg" }],
        "Even Wat Anders": [
          { category: "klassiek", title: "Bach: Jesu, Joy of Man’s Desiring", composer: "J.S. Bach" }
        ]
      }
    };
    return { text: JSON.stringify(s), usage: null };
  }

  ensureKey();
  const body = buildBody({ system, prompt, model, temperature, top_p, max_tokens });

  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OR_KEY}`,
      "HTTP-Referer": process.env.OR_REFERER || "https://bijbelzoek.nl",
      "X-Title": process.env.OR_TITLE || "Bijbelzoek",
    },
    body: JSON.stringify(body),
  });

  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch { json = null; }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `OpenRouter error ${res.status}`);
    err.status = res.status; err.code = json?.error?.code || "openrouter_error"; err.details = json || txt;
    throw err;
  }
  const content = json?.choices?.[0]?.message?.content ?? "";
  return { text: content, usage: json?.usage || null };
}

/* =============== Stream (SSE) =============== */
export async function streamLLM({ system, prompt, model, temperature, top_p, max_tokens, onDelta, onEnd } = {}) {
  if (process.env.MOCK_LLM === "1") {
    const mock = JSON.stringify({
      type: "bijbelstudie",
      title: "Geloof & Genade — streaming mock",
      summary: "…"
    });
    // stream per 20 chars
    for (let i = 0; i < mock.length; i += 20) {
      onDelta?.(mock.slice(i, i + 20));
      await new Promise(r => setTimeout(r, 10));
    }
    onEnd?.({ usage: null });
    return;
  }

  ensureKey();
  const body = {
    ...buildBody({ system, prompt, model, temperature, top_p, max_tokens }),
    stream: true,
  };

  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OR_KEY}`,
      "HTTP-Referer": process.env.OR_REFERER || "https://bijbelzoek.nl",
      "X-Title": process.env.OR_TITLE || "Bijbelzoek",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`OpenRouter stream error ${res.status}`);
    err.status = res.status; err.code = "openrouter_stream_error"; err.details = txt || null;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) buffer += decoder.decode(value, { stream: true });

    // parse SSE: split op dubbele newline
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const packet = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);

      if (!packet) continue;
      const lines = packet.split(/\r?\n/);
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!dataLine) continue;

      const data = dataLine.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const j = JSON.parse(data);
        const delta = j?.choices?.[0]?.delta?.content || "";
        if (delta) onDelta?.(delta);
      } catch {
        // ignore parse errors for partials
      }
    }
  }

  onEnd?.({ usage: null });
}
