
// ai.js — Client-side AI helper (Front-end) for Bijbelzoek.nl
// ----------------------------------------------------------------------------
// This version is aligned with the existing backend route:
//   POST /api/ai/compose/stream  (SSE passthrough from OpenRouter)
// It parses SSE and emits content tokens via onToken.
//
// Key changes vs. previous broken file:
// - REMOVED any Express/server code from the client bundle
// - Backend endpoint changed to /api/ai/compose/stream (to match server)
// - Proper SSE parsing for backend streaming
// - Block→mode mapping to match server modes: bijbelstudie | preek | liederen | actueelmedia
// - Still supports direct OpenRouter (if VITE_OPENROUTER_API_KEY is set)
// ============================================================================

/* eslint-disable no-console */

export const MODELS = [
  { key: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (OpenRouter)", vendor: "openrouter" },
  { key: "openai/gpt-4.1-mini",         label: "GPT-4.1 Mini (OpenRouter)",      vendor: "openrouter" },
  { key: "google/gemini-1.5-pro",       label: "Gemini 1.5 Pro (OpenRouter)",    vendor: "openrouter" },
  { key: "mistral/mistral-large",       label: "Mistral Large (OpenRouter)",      vendor: "openrouter" },
  { key: "deepseek/deepseek-reasoner",  label: "DeepSeek Reasoner (OpenRouter)",  vendor: "openrouter" },
];

export const DEFAULT_MODEL_KEY = MODELS[0]?.key || "anthropic/claude-3.5-sonnet";

// ---- Prompt scaffolding for direct OpenRouter transport ---------------------
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

export const COMMON_SECTIONS = {
  CONTEXT: "## Contextanalyse (teksten + grafiek/voorkomens)",
  HANDVATTEN: "## Handvatten voor verdere uitwerking",
  KRUISVERWIJZINGEN: "## Kruisverwijzingen & thema-verbindingen",
  SUGGESTIES: "## Suggesties voor verdieping (bronnen)",
};

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

// ---- Helpers to build OpenRouter messages (only for openrouter transport) ---
export function buildMessages({ block, userInput = {} }) {
  const tmpl = PROMPT_TEMPLATES[block];
  if (!tmpl) throw new Error(`Onbekend blok: ${block}`);
  const userPrompt = tmpl(userInput);
  return [
    { role: "system", content: BASE_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}

// ---- Backend compose/stream (SSE) -------------------------------------------
function blockToMode(block) {
  switch (block) {
    case "PREEK":
      return "preek";
    case "KUNST_LIED":
      return "liederen";
    case "NIEUWS":
      return "actueelmedia";
    case "BIJBELSTUDIE":
    default:
      return "bijbelstudie";
  }
}

/**
 * Stream from backend /api/ai/compose/stream (SSE passthrough).
 * Body: { mode, context, extra }
 */
async function streamFromBackendCompose({ block, userInput, onToken, signal }) {
  const mode = blockToMode(block);
  const context = {
    thema: userInput?.thema || null,
    passages: userInput?.passages || null,
    notities: userInput?.notities || null,
    grafiekObservaties: userInput?.grafiekObservaties || null,
    vertaling: userInput?.vertaling || null,
  };

  const urlBase = import.meta?.env?.VITE_API_BASE || "";
  const res = await fetch(`${urlBase}/api/ai/compose/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, context, extra: "" }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Backend AI stream error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE chunks => split by double newline
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map((l) => l.trim());
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta && onToken) onToken(delta);
        } catch {
          // some providers send keep-alives or non-JSON lines
        }
      }
    }
  }
}

// ---- Direct OpenRouter streaming (client-side; only if api key is set) ------
async function streamFromOpenRouter({ model, messages, onToken, signal }) {
  const apiKey = import.meta?.env?.VITE_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENROUTER_API_KEY ontbreekt (of gebruik backend /api/ai/compose/stream)");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": (typeof window !== "undefined" && window.location?.origin) || "https://bijbelzoek.nl",
      "X-Title": "Bijbelzoek.nl",
    },
    body: JSON.stringify({ model, messages, stream: true }),
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

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map((l) => l.trim());
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta && onToken) onToken(delta);
        } catch {}
      }
    }
  }
}

// ---- Public API -------------------------------------------------------------
/**
 * Run AI with streaming.
 * By default uses backend compose/stream. If VITE_OPENROUTER_API_KEY is set, you can pass transport='openrouter'.
 */
export async function runAI({
  block,               // 'BIJBELSTUDIE' | 'PREEK' | 'KUNST_LIED' | 'NIEUWS'
  userInput = {},      // { thema, passages:[], notities, grafiekObservaties, vertaling }
  modelKey = DEFAULT_MODEL_KEY,
  onToken,             // (delta) => void
  signal,
  transport = import.meta?.env?.VITE_OPENROUTER_API_KEY ? "openrouter" : "backend",
}) {
  if (transport === "openrouter") {
    const messages = buildMessages({ block, userInput });
    await streamFromOpenRouter({ model: modelKey, messages, onToken, signal });
  } else {
    await streamFromBackendCompose({ block, userInput, onToken, signal });
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

// ============================================================================
// END OF ai.js (client-side)
// ============================================================================
