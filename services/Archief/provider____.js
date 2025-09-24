// server/services/provider.js
// ESM + Node >=18 (native fetch/undici)
import "dotenv/config.js";

/* =========================
   OpenRouter config & utils
   ========================= */

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isTransient = (status) =>
  [408, 409, 425, 429, 500, 502, 503, 504, 522, 524].includes(status);

function orHeaders() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY ontbreekt");
  }
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(process.env.OPENROUTER_REFERER
      ? { "HTTP-Referer": process.env.OPENROUTER_REFERER }
      : {}),
    ...(process.env.OPENROUTER_TITLE
      ? { "X-Title": process.env.OPENROUTER_TITLE }
      : {}),
  };
}

/** Lees eerst als tekst en probeer daarna JSON te parsen — voorkomt 'Unexpected end of JSON input'. */
async function readJsonSafe(resp) {
  const raw = await resp.text(); // kan leeg zijn
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // laat json op null; caller gebruikt raw voor foutmelding/snippet
  }
  return { raw, json };
}

const bodyFromArgs = ({
  system,
  prompt,
  model,
  temperature,
  max_tokens,
  top_p,
  stream = false,
}) => ({
  model: model || DEFAULT_MODEL,
  stream,
  temperature,
  ...(top_p ? { top_p } : {}),
  max_tokens: clamp(max_tokens ?? 900, 64, 4000),
  messages: [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ],
});

/* =========================
   Non-stream: callLLM
   ========================= */

/**
 * @param {{system?:string,prompt:string,model?:string,temperature?:number,max_tokens?:number,top_p?:number}} args
 * @returns {Promise<{text:string,usage?:any}>}
 */
export async function callLLM({
  system = "Je bent een Nederlandstalige Bijbelstudie-assistent (HSV/NKJV). Wees nauwkeurig, Christus-centraal, pastoraal en praktisch.",
  prompt,
  model = DEFAULT_MODEL,
  temperature = 0.6,
  max_tokens = 900,
  top_p,
} = {}) {
  if (!prompt) throw new Error("callLLM: prompt ontbreekt");

  const headers = orHeaders();
  const payload = bodyFromArgs({
    system,
    prompt,
    model,
    temperature,
    max_tokens,
    top_p,
    stream: false,
  });

  // kleine retry op transiente fouten
  const MAX_RETRIES = 2;
  let attempt = 0;

  while (true) {
    attempt++;
    // eigen timeout per poging
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 35_000);

    let resp;
    try {
      resp = await fetch(OR_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt <= MAX_RETRIES) {
        await sleep(300 * attempt);
        continue;
      }
      throw new Error(`OpenRouter fetch error: ${e.message}`);
    }
    clearTimeout(timer);

    const { raw, json } = await readJsonSafe(resp);

    if (!resp.ok) {
      if (isTransient(resp.status) && attempt <= MAX_RETRIES) {
        await sleep(400 * attempt);
        continue;
      }
      const snippet = (raw || "").slice(0, 400);
      const msg =
        json?.error?.message ||
        json?.message ||
        `${resp.status} ${resp.statusText}`;
      throw new Error(`OpenRouter ${msg}: ${snippet}`);
    }

    // sommige modellen geven message.content, andere choices[].text
    const text =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      "";

    if (!text) {
      throw new Error("OpenRouter: leeg antwoord");
    }

    return { text: String(text).trim(), usage: json?.usage || null };
  }
}

/* =========================
   Stream: streamLLM (SSE)
   ========================= */

/**
 * @param {{system?:string,prompt:string,model?:string,temperature?:number,max_tokens?:number,top_p?:number,onDelta?:(s:string)=>void,onEnd?:(meta?:{usage?:any})=>void}} args
 */
export async function streamLLM({
  system = "Je bent een Nederlandstalige Bijbelstudie-assistent (HSV/NKJV). Wees nauwkeurig, Christus-centraal, pastoraal en praktisch.",
  prompt,
  model = DEFAULT_MODEL,
  temperature = 0.6,
  max_tokens = 900,
  top_p,
  onDelta,
  onEnd,
} = {}) {
  if (!prompt) throw new Error("streamLLM: prompt ontbreekt");

  const headers = orHeaders();
  const payload = bodyFromArgs({
    system,
    prompt,
    model,
    temperature,
    max_tokens,
    top_p,
    stream: true,
  });

  // timeout op stream-start (als er nooit data komt)
  const ac = new AbortController();
  const startTimer = setTimeout(() => ac.abort("Stream timeout"), 40_000);

  const resp = await fetch(OR_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: ac.signal,
  }).catch((e) => {
    clearTimeout(startTimer);
    throw new Error(`OpenRouter stream fetch error: ${e.message}`);
  });

  if (!resp.ok) {
    clearTimeout(startTimer);
    let raw = "";
    try {
      raw = await resp.text();
    } catch {}
    const snippet = (raw || "").slice(0, 400);
    throw new Error(
      `OpenRouter stream ${resp.status} ${resp.statusText}: ${snippet}`
    );
  }

  if (!resp.body) {
    clearTimeout(startTimer);
    throw new Error("OpenRouter stream: lege body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let usageFromStream = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      clearTimeout(startTimer); // we HEBBEN data — start is gelukt
      buffer += decoder.decode(value, { stream: true });

      // SSE events zijn gescheiden door dubbele newline
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        // elke regel in het event (kan meerdere 'data:' regels hebben)
        const lines = chunk.split("\n");
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            onEnd?.({ usage: usageFromStream });
            return;
          }

          // Probeer JSON; zo niet, behandel als plain text
          try {
            const json = JSON.parse(data);

            // sommige providers sturen usage tussendoor
            if (json?.usage) usageFromStream = json.usage;

            const delta =
              json?.choices?.[0]?.delta?.content ??
              json?.choices?.[0]?.message?.content ??
              json?.choices?.[0]?.text ??
              "";

            if (delta) onDelta?.(String(delta));
          } catch {
            if (data) onDelta?.(String(data));
          }
        }
      }
    }
  } finally {
    clearTimeout(startTimer);
  }

  onEnd?.({ usage: usageFromStream });
}
