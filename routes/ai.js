// ai.js — Client AI helper for Bijbelzoek.nl (single OpenRouter model + backend fallback)
// ----------------------------------------------------------------------------
// - Uses ONE OpenRouter model (fit-for-the-job): anthropic/claude-3.5-sonnet
// - Streams tokens (SSE) directly from OpenRouter when VITE_OPENROUTER_API_KEY is present
// - Falls back to your backend route /api/ai/compose/stream (SSE passthrough) if no client key
// - Prompt scaffolding as provided (geen gebed, geen uitgeschreven preek, eerst contextanalyse)
// - Compatible with modes from ai_latest_build.js: bijbelstudie | preek | liederen | actueelmedia
// ============================================================================

/* eslint-disable no-console */

export const BLOCKS = {
  BIJBELSTUDIE: "BIJBELSTUDIE",
  PREEK: "PREEK",
  KUNST_LIED: "KUNST_LIED",
  NIEUWS: "NIEUWS",
};

// ---- Selected model (single) ------------------------------------------------
export const OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet"; // fit for long, careful analysis
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

// ---- Helpers to build OpenRouter messages (for openrouter transport) --------
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
// Map UI block to server mode (ai_latest_build.js)
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

async function streamFromBackend({ block, userInput, onToken, signal }) {
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
    // stuur onze strikte regels ook mee, zodat serverprompt dit meekrijgt
    body: JSON.stringify({ mode, context, extra: "GEEN gebed. GEEN uitgeschreven preek. Start met Contextanalyse; geef daarna handvatten en bronnen." }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Backend AI stream error: ${res.status}`);

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
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta && onToken) onToken(delta);
        } catch {
          // keep-alives or non-JSON
        }
      }
    }
  }
}

// ---- Direct OpenRouter streaming (client-side) ------------------------------
async function streamFromOpenRouter({ block, userInput, onToken, signal }) {
  const apiKey = import.meta?.env?.VITE_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENROUTER_API_KEY ontbreekt (of gebruik backend /api/ai/compose/stream)");

  const messages = buildMessages({ block, userInput });

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": (typeof window !== "undefined" && window.location?.origin) || "https://bijbelzoek.nl",
      "X-Title": "Bijbelzoek.nl",
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, stream: true, messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter error: ${res.status} ${res.statusText}`);
  }

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
        } catch {
          // ignore keep-alives
        }
      }
    }
  }
}

// ---- Public API -------------------------------------------------------------
/**
 * Stream AI output as markdown text.
 * Default: use OpenRouter directly when VITE_OPENROUTER_API_KEY is set; otherwise fall back to backend SSE.
 */
export async function runAI({
  block,               // 'BIJBELSTUDIE' | 'PREEK' | 'KUNST_LIED' | 'NIEUWS'.
  userInput = {},      // { thema, passages:[], notities, grafiekObservaties, vertaling }
  onToken,             // (delta) => void
  signal,
  transport = (import.meta?.env?.VITE_OPENROUTER_API_KEY ? "openrouter" : "backend"),
}) {
  if (transport === "openrouter") {
    await streamFromOpenRouter({ block, userInput, onToken, signal });
  } else {
    await streamFromBackend({ block, userInput, onToken, signal });
  }
}

/**
 * Utility: extract [label](href) links from markdown for side-panels.
 */
export function extractLinksFromMarkdown(md = "") {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const out = [];
  let m;
  while ((m = linkRegex.exec(md))) out.push({ label: m[1], href: m[2] });
  return out;
}
