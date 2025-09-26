// server/utils/build-docx.js
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel,
  ShadingType, ImageRun
} from "docx";
import dayjs from "dayjs";
import "dayjs/locale/nl.js";
import { splitLines, normalizeText, decodeDataUrl, parseAiProse } from "./text.js";

dayjs.locale("nl");

const ACCENT = "4F46E5";
const ACCENT_LIGHT = "EEF2FF";
const MUTED  = "6B7280";
const BODY_SIZE = 22;
const H1_SIZE = 48;
const H2_SIZE = 32;
const H3_SIZE = 26;

/** ===== Multi-line helpers (fix: zichtbare enters) ===== */
function paraML(text = "", { italics = false, bold = false, color, size, before = 40, after = 160 } = {}) {
  const lines = splitLines(String(text)); // split op \n
  const children = lines.length ? lines.map((ln, i) =>
    new TextRun({ text: ln, italics, bold, color, size, ...(i ? { break: 1 } : {}) })
  ) : [new TextRun({ text: "", italics, bold, color, size })];

  return new Paragraph({ children, spacing: { before, after } });
}
const P  = (t)=> paraML(t, { before: 40, after: 160 });
const Em = (t)=> paraML(t, { italics: true, color: MUTED, before: 20, after: 140 });

const H1 = (t)=> new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 240, after: 200 },
  children: [ new TextRun({ text: t, bold: true, color: ACCENT, size: H1_SIZE }) ]
});
const H2 = (t)=> new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 200, after: 160 },
  children: [ new TextRun({ text: t, bold: true, color: ACCENT, size: H2_SIZE }) ]
});
const H3 = (t)=> new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 140, after: 120 },
  children: [ new TextRun({ text: t, bold: true, color: ACCENT, size: H3_SIZE }) ]
});

function TitleSection(theme) {
  return {
    properties: {},
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
        children: [ new TextRun({ text: theme, bold: true, color: ACCENT, size: 64 }) ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 160 },
        children: [ new TextRun({ text: "gegenereerd met Bijbelzoek.nl", italics: true, color: MUTED, size: 24 }) ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 20, after: 100 },
        children: [ new TextRun({ text: dayjs().format("D MMMM YYYY"), color: MUTED, size: 24 }) ],
      }),
    ]
  };
}

function NotesBox(label = "Extra aantekeningen", lines = 6) {
  const content = [
    paraML(label, { bold: true, color: MUTED, before: 0, after: 80 })
  ];
  for (let i = 0; i < lines; i++) {
    content.push(new Paragraph({ children: [new TextRun(" ")], spacing: { after: 160 } }));
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: "FFFFFF", fill: ACCENT_LIGHT },
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: MUTED },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: MUTED },
      left: { style: BorderStyle.SINGLE, size: 1, color: MUTED },
      right: { style: BorderStyle.SINGLE, size: 1, color: MUTED }
    },
    rows: [ new TableRow({ children: [ new TableCell({ children: content }) ] }) ]
  });
}

function SectionHeader(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [ new TableRow({
      children: [ new TableCell({
        shading: { type: ShadingType.CLEAR, color: "FFFFFF", fill: ACCENT_LIGHT },
        children: [ new Paragraph({
          children: [ new TextRun({ text, bold: true, color: ACCENT, size: H1_SIZE }) ],
          spacing: { before: 120, after: 160 }
        }) ]
      }) ]
    }) ]
  });
}

function ChartCaption(c) {
  const w = Array.isArray(c?.words) ? c.words.filter(Boolean) : [];
  if (!w.length) return [];
  return [
    paraML(
      `Labels: ${w.join(" · ")}`,
      { color: MUTED, before: 40, after: 200 }
    )
  ];
}

function imageParagraphFromBuffer(buf, w, h) {
  return new Paragraph({
    spacing: { before: 160, after: 120 },
    children: [ new ImageRun({ data: buf, transformation: { width: w, height: h } }) ]
  });
}

async function chartBlock(chart) {
  const dataUrl = chart?.imageData || chart?.dataUrl || chart?.png || chart?.image || null;
  if (!dataUrl) return [ Em("Grafiekgegevens ontbreken.") ];
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded?.buffer) return [ Em("Grafiekgegevens ontbreken.") ];

  const srcW = Number(chart?.docxWidth || 640);
  const srcH = Number(chart?.docxHeight || 360);
  const maxW = 700;
  const scale = Math.min(maxW / srcW, 1.35);
  const targetW = Math.max(580, Math.round(srcW * scale));
  const targetH = Math.round(srcH * scale);

  return [
    imageParagraphFromBuffer(decoded.buffer, targetW, targetH),
    ...ChartCaption(chart),
    new Paragraph({ children: [new TextRun(" ")], spacing: { before: 120, after: 160 } }),
  ];
}

function renderScripturesDOCX(arr = []) {
  const nodes = []; if (!arr.length) return nodes;
  nodes.push(H3("Centrale gedeelten"));
  arr.forEach(({ ref, text }) => {
    nodes.push(P(ref));
    if (text) nodes.push(Em(text)); // Em is nu multi-line aware
  });
  return nodes;
}
function renderQuestionsDOCX(arr = []) {
  const nodes = []; if (!arr.length) return nodes;
  nodes.push(H3("Gespreksvragen"));
  arr.forEach((q) => nodes.push(P(`• ${q}`)));
  return nodes;
}
function renderSectionsDOCX(sections = []) {
  const nodes = [];
  sections.forEach((sec) => {
    if (!sec) return;
    if (sec.title) nodes.push(H3(sec.title));
    (sec.items || []).forEach((pt) => nodes.push(P(`• ${pt}`)));
  });
  return nodes;
}
function renderGenericStructured(r) {
  const known = new Set(["title","summary","outline","news","media","scriptures","passages","bijbelteksten","questions","vragen","theme","kind"]);
  const nodes = [];
  if (r && r.structured) {
    for (const [k, v] of Object.entries(r.structured)) {
      if (known.has(k)) continue;
      if (Array.isArray(v) && v.length) {
        nodes.push(H3(k.charAt(0).toUpperCase() + k.slice(1)));
        v.forEach(item => nodes.push(P(typeof item === "string" ? `• ${item}` : `• ${JSON.stringify(item)}`)));
      } else if (typeof v === "string" && v.trim()) {
        nodes.push(H3(k.charAt(0).toUpperCase() + k.slice(1)));
        nodes.push(P(v)); // P is multi-line aware
      }
    }
  }
  return nodes;
}
function groupByKind(ai = []) {
  const order = ["preek","bijbelstudie","liederen","actueelmedia"];
  const labels = { preek: "Preek", bijbelstudie: "Bijbelstudie", liederen: "Liederen", actueelmedia: "Nieuws & Media" };
  const map = new Map(order.map(k => [k, []]));
  ai.forEach(r => { const k = (r.kind || "").toLowerCase(); map.set(k, (map.get(k) || []).concat(r)); });
  return { order, labels, map };
}

export async function buildDocxBuffer(payload = {}, { theme }) {
  const doc = new Document({
    creator: "Bijbelzoek.nl",
    title: theme || "Bijbelstudie",
    description: "Export vanuit Bijbelzoek.nl",
    styles: { default: { document: { run: { size: BODY_SIZE } } } },
    sections: []
  });

  // Titelblad
  doc.addSection(TitleSection(theme || "Bijbelstudie"));

  const children = [];

  // AI-resultaten
  const ai = Array.isArray(payload.aiResults) ? payload.aiResults : [];
  if (ai.length) {
    children.push(SectionHeader("AI-resultaten"));
    const { order, labels, map } = groupByKind(ai);
    for (const k of order) {
      const list = map.get(k) || [];
      if (!list.length) continue;
      children.push(H2(labels[k]));
      for (const r of list) {
        const headingTitle = r?.structured?.title || r?.title || null;
        if (headingTitle) children.push(H3(headingTitle));

        const parsed = parseAiProse(r?.text || "");
        const summary = r?.structured?.summary || parsed.summary;
        if (summary) children.push(Em(summary));

        const outline = r?.structured?.outline;
        if (Array.isArray(outline) && outline.length) {
          outline.forEach((sec) => {
            const head = sec?.kop || sec?.title || "-";
            children.push(H3(head));
            (sec?.opsomming || sec?.punten || sec?.inhoud || sec?.points || []).forEach(pt => children.push(P(`• ${String(pt)}`)));
          });
        } else {
          children.push(...renderSectionsDOCX(parsed.sections));
        }

        const scriptures = r?.structured?.scriptures || r?.structured?.passages || r?.structured?.bijbelteksten || parsed.scriptures;
        children.push(...renderScripturesDOCX(scriptures));

        const questions = r?.structured?.questions || r?.structured?.vragen || parsed.questions;
        children.push(...renderQuestionsDOCX(questions));

        children.push(...renderGenericStructured(r));

        if (r?.text) {
  const txt = String(r.text).trim();
  if (txt) {
    children.push(H3("Overige tekst"));
    splitLines(txt).forEach(line => children.push(P(line)));
  }
}
      }
    }
  }

  // Teksten
  const texts = Array.isArray(payload.favoritesTexts) ? payload.favoritesTexts : payload.favTexts;
  if (texts && texts.length) {
    children.push(SectionHeader("Teksten"));
    children.push(NotesBox("Extra aantekeningen — Teksten"));
    for (const t of texts) {
      children.push(H2(t?.ref || "Tekst"));
      if (t?.text) children.push(P(t.text)); // multi-line
      if (t?.note) children.push(Em(`Notitie: ${normalizeText(t.note)}`));
    }
  }

  // Grafieken
  const charts = Array.isArray(payload.favoritesCharts) ? payload.favoritesCharts : payload.favCharts;
  if (Array.isArray(charts) && charts.length) {
    children.push(SectionHeader("Grafieken"));
    children.push(NotesBox("Extra aantekeningen — Grafieken"));
    for (let idx = 0; idx < charts.length; idx++) {
      const c = charts[idx];
      const block = await chartBlock(c);
      children.push(...block);
      if (c?.note) children.push(Em(`Notitie: ${normalizeText(c.note)}`));
      children.push(new Paragraph({ children: [new TextRun(" ")], spacing: { before: 160, after: 160 } }));
    }
  }

  doc.addSection({ children });
  return await Packer.toBuffer(doc);
}
