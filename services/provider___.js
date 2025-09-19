// server/services/provider.js
import "dotenv/config.js";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function withTimeout(run, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("Timeout"), ms);
  return run(ctrl.signal).finally(() => clearTimeout(t));
}

/** Non-stream: { text, usage? } */
export async function callLLM({
  system = "Je bent een Nederlandstalige Bijbelstudie-assistent (HSV/NKJV). Wees nauwkeurig, Christus-centraal, pastoraal en praktisch.",
  prompt,
  model = process.env.OPENROUTER_MODEL || "qwen/qwen-2.5-72b-instruct",
  temperature = 0.6,
  max_tokens = 900,
  top_p, // optioneel
}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY ontbreekt");
  if (!prompt) throw new Error("callLLM: prompt ontbreekt");

  return withTimeout(async (signal) => {
    const r = await fetch(OR_URL, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_REFERER } : {}),
        ...(process.env.OPENROUTER_TITLE   ? { "X-Title": process.env.OPENROUTER_TITLE } : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        ...(top_p ? { top_p } : {}),
        max_tokens: clamp(max_tokens, 64, 4000),
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });

    const j = await r.json();
    if (!r.ok) {
      const msg = j?.error?.message || j?.message || `${r.status} ${r.statusText}`;
      throw new Error(`OpenRouter error: ${msg}`);
    }
    const text = j?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("OpenRouter: leeg antwoord");
    return { text, usage: j?.usage };
  });
}

/** Stream: roept onDelta voor elk tekstdeel aan; onEnd(meta) aan het einde. */
export async function streamLLM({
  system = "Je bent een Nederlandstalige Bijbelstudie-assistent (HSV/NKJV). Wees nauwkeurig, Christus-centraal, pastoraal en praktisch.",
  prompt,
  model = process.env.OPENROUTER_MODEL || "qwen/qwen-2.5-72b-instruct",
  temperature = 0.6,
  max_tokens = 900,
  top_p, // optioneel
  onDelta,
  onEnd,
}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY ontbreekt");
  if (!prompt) throw new Error("streamLLM: prompt ontbreekt");

  return withTimeout(async (signal) => {
    const resp = await fetch(OR_URL, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_REFERER } : {}),
        ...(process.env.OPENROUTER_TITLE   ? { "X-Title": process.env.OPENROUTER_TITLE } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        ...(top_p ? { top_p } : {}),
        max_tokens: clamp(max_tokens, 64, 4000),
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      let j;
      try { j = await resp.json(); } catch {}
      const msg = j?.error?.message || j?.message || `${resp.status} ${resp.statusText}`;
      throw new Error(`OpenRouter stream error: ${msg}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const lineRaw of event.split("\n")) {
          const line = lineRaw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { onEnd?.({}); return; }
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content
                       ?? json?.choices?.[0]?.message?.content
                       ?? "";
            if (delta) onDelta?.(delta);
            if (json?.usage) onEnd?.({ usage: json.usage });
          } catch {
            if (data) onDelta?.(data);
          }
        }
      }
    }
    onEnd?.({});
  }, 60000);
}
