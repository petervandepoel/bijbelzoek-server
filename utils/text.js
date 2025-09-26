import slugify from "slugify";

export function deriveTheme(payload = {}) {
  const ai = Array.isArray(payload.aiResults) ? payload.aiResults : [];
  for (const r of ai) {
    if (r?.structured?.theme) return String(r.structured.theme);
    if (r?.structured?.title) return String(r.structured.title);
    if (r?.title) return String(r.title).split("—")[0].trim();
  }
  const charts = Array.isArray(payload.favoritesCharts) ? payload.favoritesCharts : payload.favCharts;
  if (Array.isArray(charts) && charts.length) {
    const words = Array.from(new Set(charts.flatMap((c) => c.words || []))).filter(Boolean);
    if (words.length) return words.slice(0, 3).join(", ");
  }
  const texts = Array.isArray(payload.favoritesTexts) ? payload.favoritesTexts : payload.favTexts;
  if (Array.isArray(texts) && texts.length) {
    if (texts[0]?.ref) return String(texts[0].ref);
  }
  return "Bijbelstudie";
}

export function makeFilename(theme, dateStr, type) {
  const niceTheme = (theme ? theme.replace(/[\\/:*?"<>|]+/g, " ").trim() : "Bijbelstudie");
  const base = `${niceTheme}_Bijbelzoek.nl_Export_${dateStr}`;
  const ext = type === "pdf" ? ".pdf" : ".docx";
  return slugify(base, { lower: false, strict: true }) + ext;
}

export const splitLines = (text = "") => String(text).replace(/\\r\\n/g, "\\n").split("\\n");
export const normalizeText = (text = "") => String(text).replace(/\\r\\n/g, "\\n").trim();

export function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const prefixes = ["data:image/png;base64,", "data:image/jpeg;base64,"];
  const prefix = prefixes.find((p) => dataUrl.startsWith(p));
  if (!prefix) return null;
  const b64 = dataUrl.slice(prefix.length);
  try { return { buffer: Buffer.from(b64, "base64") }; } catch { return null; }
}

/** Parse AI prose for fallback sections. */
export function parseAiProse(text = "") {
  const lines = splitLines(text);
  const out = { summary: "", sections: [], scriptures: [], questions: [] };
  let mode = null;
  let currentSection = null;

  function startSection(title) {
    if (currentSection) out.sections.push(currentSection);
    currentSection = { title, items: [] };
  }
  function finish() {
    if (currentSection) out.sections.push(currentSection);
  }

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const header = line.replace(/^[-•\\d\\.\\)]\\s*/, "").toLowerCase();

    if (/^samenvatting$/i.test(header)) { mode = "summary"; continue; }
    if (/^structuur/i.test(header)) { mode = "structure"; continue; }
    if (/^centrale gedeelten/i.test(header)) { mode = "scriptures"; continue; }
    if (/^gespreksvragen/i.test(header)) { mode = "questions"; continue; }

    if (mode === "summary") {
      out.summary += (out.summary ? "\\n" : "") + line;
      continue;
    }

    if (mode === "structure") {
      if (!/^[-•*]/.test(raw) && /^[A-Za-zÀ-ÿ].+/.test(line)) {
        startSection(line);
        continue;
      }
      const item = line.replace(/^[-•*]\\s*/, "");
      if (!currentSection) startSection("Structuur");
      currentSection.items.push(item);
      continue;
    }

    if (mode === "scriptures") {
      const m = line.match(/^([1-3]?\\s*[A-Za-zÀ-ÿ\\.]+(?:\\s+[A-Za-zÀ-ÿ\\.]+)*)\\s+\\d+:\\d+(?:-\\d+)?/);
      if (m) {
        out.scriptures.push({ ref: line, text: "" });
      } else if (out.scriptures.length) {
        const last = out.scriptures[out.scriptures.length - 1];
        last.text = (last.text ? last.text + "\\n" : "") + line;
      } else {
        out.scriptures.push({ ref: line, text: "" });
      }
      continue;
    }

    if (mode === "questions") {
      const q = line.replace(/^[-•*]\\s*/, "");
      out.questions.push(q);
      continue;
    }
  }

  finish();
  return out;
}