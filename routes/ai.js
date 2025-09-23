// ============================================================================
// ai.js — Multi-model AI client with streaming for Bijbelzoek.nl
// ----------------------------------------------------------------------------
// Features
// - Multiple AI models (OpenRouter-ready) with easy switching
// - Strong prompt templates per blok: Bijbelstudie, Preek (outline-only),
//   Kunst & Lied, Actueel & Nieuws
// - Enforces: GEEN gebed, GEEN uitgeschreven preek
// - Always starts with Contextanalyse (incl. grafiek/voorkomens-observaties)
// - Markdown output (no JSON), perfect for streaming into AiResultCard
// - Two transport options:
//    1) Direct to OpenRouter (VITE_OPENROUTER_API_KEY in client)
//    2) Via backend proxy at /api/ai/stream (recommended)
// - Helper: extractLinksFromMarkdown for AiResultCard side panel
// ============================================================================

/* eslint-disable no-console */

/** @typedef {import('react').ReactNode} ReactNode */

// ---- Model catalog ----------------------------------------------------------
export const MODELS = [
  {
    key: "anthropic/claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet (OpenRouter)",
    vendor: "openrouter",
    strengths: ["lange context", "pastorale toon", "analyse"],
  },
  {
    key: "openai/gpt-4.1-mini",
    label: "GPT-4.1 Mini (OpenRouter)",
    vendor: "openrouter",
    strengths: ["snel", "betaalbaar", "evenwichtig"],
  },
  {
    key: "google/gemini-1.5-pro",
    label: "Gemini 1.5 Pro (OpenRouter)",
    vendor: "openrouter",
    strengths: ["lange context", "structuur", "koppelingen"],
  },
  {
    key: "mistral/mistral-large",
    label: "Mistral Large (OpenRouter)",
    vendor: "openrouter",
    strengths: ["compact", "nuchter", "snel"],
  },
  {
    key: "deepseek/deepseek-reasoner",
    label: "DeepSeek Reasoner (OpenRouter)",
    vendor: "openrouter",
    strengths: ["diepe redenering", "analyse"],
  },
];

export const DEFAULT_MODEL_KEY = MODELS[0]?.key || "anthropic/claude-3.5-sonnet";

// ---- Prompt scaffolding -----------------------------------------------------
const BASE_SYSTEM_PROMPT = `
Je bent een academisch onderbouwde maar pastorale studie-assistent in een protestants/evangelische context voor Bijbelzoek.nl.
BELANGRIJKE REGELS (must):
- Geen gebed opnemen.
- Geen uitgeschreven preek opnemen (alleen outline/handvatten). 
- Begin ALTIJD met een **Contextanalyse** op basis van de ingevoerde teksten en grafiek/voorkomens per bijbelboek (indien beschikbaar). Benoem opvallende concentraties per boek/hoofdstuk.
- Geef daarna **handvatten**: verbanden, kruisverwijzingen, studieaanwijzingen, zoekpaden.
- Schrijf in helder Nederlands, markdown, duidelijke koppen en lijstjes.
- Bij citaten uit liedteksten maximaal 10 woorden (anders parafraseren).
- Wees bronnenrijk en concreet; geen placeholders.
`;

// Headings shared across blocks — consistent UI in AiResultCard
export const COMMON_SECTIONS = {
  CONTEXT: "## Contextanalyse (teksten + grafiek/voorkomens)",
  HANDVATTEN: "## Handvatten voor verdere uitwerking",
  KRUISVERWIJZINGEN: "## Kruisverwijzingen & thema-verbindingen",
  SUGGESTIES: "## Suggesties voor verdieping (bronnen)",
};

/**
 * Templates per blok.
 * Vars per call: { thema, passages: string[], notities, grafiekObservaties, vertaling }
 */
const PROMPT_TEMPLATES = {
  BIJBELSTUDIE: ({ thema, passages, notities, grafiekObservaties, vertaling }) => `
# BIJBELSTUDIE — ${thema || "(thema niet opgegeven)"}

${COMMON_SECTIONS.CONTEXT}
- Gebruik de genoemde passages (${passages?.join(", ") || "n.v.t."}) en eventuele grafiekobservaties: ${grafiekObservaties || "(geen)"}.
- Kijk naar opvallende concentraties per bijbelboek/hoofdstuk en mogelijke reden (historisch, genre, context).

${COMMON_SECTIONS.HANDVATTEN}
- Lever 6–12 concrete studievragen (observatie→uitleg→toepassing), werkvormen en leesstappen.
- Geef 2–4 mogelijke leesroutes (OT→NT, narratief→leer, enz.).

${COMMON_SECTIONS.KRUISVERWIJZINGEN}
- Toon een compacte lijst (±10) met redenen waarom deze relevant zijn.

${COMMON_SECTIONS.SUGGESTIES}
- 6–10 bronnen (commentaren, handboeken, artikelen, podcasts), elk met 1-regel motivatie.

**Niet opnemen:** gebed; uitgeschreven preek.

**Aantekeningen gebruiker:** ${notities || "(geen)"}
**Voorkeursvertaling:** ${vertaling || "HSV"}
`,

  PREEK: ({ thema, passages, notities, grafiekObservaties, vertaling }) => `
# PREEK (ALLEEN OUTLINE & HANDVATTEN) — ${thema || "(thema niet opgegeven)"}

${COMMON_SECTIONS.CONTEXT}
- Gebruik passages (${passages?.join(", ") || "n.v.t."}); voeg observaties uit frequenties/grafiek toe: ${grafiekObservaties || "(geen)"}.
- Benoem waarom het thema in bepaalde boeken/hoofdstukken piekt en wat dat homiletisch kan betekenen.

## Preekoutline (zonder manuscript)
- Titel, thema, 2–4 hoofdpunten met korte brug en landing.
- Illustratie-ideeën (3–5), toepassingslijnen per doelgroep (persoonlijk, gezin/kinderen, jongeren, gemeente).
- Pastoraal-sensitieve formuleringen; Bijbel met Bijbel uitleggen.

${COMMON_SECTIONS.HANDVATTEN}
- 8–12 zoekpaden voor verdere uitwerking (woordenstudie, historische context, liturgische invalshoeken, pericope-structuur).

${COMMON_SECTIONS.KRUISVERWIJZINGEN}
- Lijstje met kernteksten (OT/NT) + 1-regel hermeneutische toelichting.

${COMMON_SECTIONS.SUGGESTIES}
- 5–8 bronnen (boeken, artikelen, preekseries met transcript), met 1-regel waarom nuttig.

**Niet opnemen:** gebed; uitgeschreven preek.
**Aantekeningen gebruiker:** ${notities || "(geen)"}
**Voorkeursvertaling:** ${vertaling || "HSV"}
`,

  KUNST_LIED: ({ thema, passages, notities, grafiekObservaties }) => `
# KUNST & LIED — ${thema || "(thema niet opgegeven)"}

${COMMON_SECTIONS.CONTEXT}
- Welke emoties/thema's komen naar voren? Koppel dit aan de passages (${passages?.join(", ") || "n.v.t."}) en frequenties: ${grafiekObservaties || "(geen)"}.

## Liedsuggesties (met motivatie)
- Mix: Psalmen, Opwekking, Op Toonhoogte, hymnes. Per lied: functie (votum/aanbidding/overdenking/zegen), zeer korte kernregel (≤10 woorden), en waarom dit past.

## Kunst & Creatief
- 3–6 muziekstukken/koorwerken (klassiek/modern) met motivatie.
- 3–6 beeldende kunstwerken (schilderij/icoon/beeld) met korte duiding en (indien publiek domein) **werkende link** naar afbeelding.
- 1–3 toneel/scène-ideeën of spoken word schetsen (korte outline). 

${COMMON_SECTIONS.HANDVATTEN}
- Tips voor gemeentezang/arrangement, toonsoorten/tempo-hints (indien bekend), performance- en projecttips.

${COMMON_SECTIONS.SUGGESTIES}
- 5–8 betrouwbare bronnen (CCLI, hymnary, IMSLP, museum-collecties) met link.

**Niet opnemen:** gebed; uitgeschreven preek.
**Aantekeningen gebruiker:** ${notities || "(geen)"}
`,

  NIEUWS: ({ thema, passages, notities }) => `
# ACTUEEL & NIEUWS — ${thema || "(thema niet opgegeven)"}

${COMMON_SECTIONS.CONTEXT}
- Leg uit hoe dit thema resoneert met huidige maatschappelijke/culturele/kerkelijke ontwikkelingen; betrek passages (${passages?.join(", ") || "n.v.t."}).

## Relevante recente items (laatste 12 maanden)
- Geef 6–12 items met **datum (dd-mm-jjjj)**, outlet, [werkende link], en 1–2 zinnen duiding.
- Vermijd paywalls waar mogelijk; wees gebalanceerd en transparant over standpunten.

${COMMON_SECTIONS.HANDVATTEN}
- Concrete zoekstrategieën: keywords, alternatieve termen, namen van instituten, periodieken, databases.

${COMMON_SECTIONS.SUGGESTIES}
- 5–8 bronnen/portalen/nieuwsbrieven/podcasts met focus op kwaliteit en diversiteit.

**Niet opnemen:** gebed; uitgeschreven preek.
**Aantekeningen gebruiker:** ${notities || "(geen)"}
`,
};

// ---- Streaming helpers ------------------------------------------------------
async function streamFromOpenRouter({ model, messages, onToken, signal }) {
  const apiKey = import.meta?.env?.VITE_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENROUTER_API_KEY ontbreekt (of gebruik backend /api/ai/stream)");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": (typeof window !== "undefined" && window.location?.origin) || "https://bijbelzoek.nl",
      "X-Title": "Bijbelzoek.nl",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) throw new Error(`OpenRouter fout: ${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE chunks separated by double newlines. Each line may start with "data:"
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map(l => l.trim());
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta && onToken) onToken(delta);
        } catch {
          // ignore keep-alives
        }
      }
    }
  }
}

async function streamFromBackend({ model, messages, onToken, signal }) {
  const res = await fetch("/api/ai/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Backend AI stream error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (onToken) onToken(text);
  }
}

// ---- Public API -------------------------------------------------------------
export function buildMessages({ block, userInput = {} }) {
  const tmpl = PROMPT_TEMPLATES[block];
  if (!tmpl) throw new Error(`Onbekend blok: ${block}`);
  const userPrompt = tmpl(userInput);
  return [
    { role: "system", content: BASE_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}

/**
 * Run AI with streaming
 * @param {Object} params
 * @param {'BIJBELSTUDIE'|'PREEK'|'KUNST_LIED'|'NIEUWS'} params.block
 * @param {Object} params.userInput
 * @param {string} [params.modelKey]
 * @param {(delta:string)=>void} [params.onToken]
 * @param {AbortSignal} [params.signal]
 * @param {'openrouter'|'backend'} [params.transport]
 */
export async function runAI({
  block,
  userInput,
  modelKey = DEFAULT_MODEL_KEY,
  onToken,
  signal,
  transport = import.meta?.env?.VITE_OPENROUTER_API_KEY ? "openrouter" : "backend",
}) {
  const messages = buildMessages({ block, userInput });

  if (transport === "openrouter") {
    await streamFromOpenRouter({ model: modelKey, messages, onToken, signal });
  } else {
    await streamFromBackend({ model: modelKey, messages, onToken, signal });
  }
}

export function modelLabel(key) {
  return MODELS.find((m) => m.key === key)?.label || key;
}

export const BLOCKS = {
  BIJBELSTUDIE: "BIJBELSTUDIE",
  PREEK: "PREEK",
  KUNST_LIED: "KUNST_LIED",
  NIEUWS: "NIEUWS",
};

/**
 * Extract outbound links from markdown content.
 * Returns array of { href, label }.
 */
export function extractLinksFromMarkdown(md = "") {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const out = [];
  let m;
  while ((m = linkRegex.exec(md))) {
    out.push({ label: m[1], href: m[2] });
  }
  return out;
}

// ---- Example usage (in your React page/component) ---------------------------
// const [output, setOutput] = useState("");
// const ctrl = new AbortController();
// await runAI({
//   block: BLOCKS.BIJBELSTUDIE,
//   userInput: {
//     thema: "Hoop in lijden",
//     passages: ["Romeinen 5:1-11", "1 Petrus 1"],
//     grafiekObservaties: "Piek in Romeinen en 1 Petrus; weinig in historische boeken",
//     notities: "kring van gemengde leeftijd",
//     vertaling: "HSV",
//   },
//   modelKey: DEFAULT_MODEL_KEY,
//   onToken: (t) => setOutput((s) => s + t),
//   signal: ctrl.signal,
// });


// ============================================================================
// END OF ai.js
// ============================================================================
