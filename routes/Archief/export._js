// server/routes/export.js
import { Router } from "express";
import MarkdownIt from "markdown-it";
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  Table, TableRow, TableCell, WidthType, ImageRun, Footer, AlignmentType
} from "docx";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import "chart.js/auto";
import puppeteer from "puppeteer";

const router = Router();

const BRAND = "Bijbelzoek.nl";
const TITLE = "Studie-export";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const CHART_W = 1600;
const CHART_H = 460;
const chartCanvas = new ChartJSNodeCanvas({
  width: CHART_W,
  height: CHART_H,
  backgroundColour: "#ffffff",
});
const palette = ["#4f46e5","#f59e0b","#10b981","#ef4444","#14b8a6","#a855f7","#3b82f6","#ec4899","#84cc16","#fb923c"];
const esc = (s = "") => String(s).replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
const sumRow = (row, words) => words.reduce((a, w) => a + (Number(row[w]) || 0), 0);
const nowStr = () => new Date().toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" });

function getBaseFromReq(req) {
  const host = req.get("host");
  const proto = req.protocol || "http";
  return `${proto}://${host}`;
}

// Cache & puppeteer singleton
const chartCache = new Map();
const cacheKey = ({ version, mode = "exact", words = [] }) => `${version}|${mode}|${[...(words || [])].sort().join(",")}`;
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"] });
    process.on("exit", async () => (await browserPromise)?.close().catch(() => {}));
  }
  return browserPromise;
}
let pdfQueue = Promise.resolve();
function enqueuePdfJob(job) {
  const run = () => job().catch((e) => { throw e; });
  const p = pdfQueue.then(run, run);
  pdfQueue = p.catch(() => {});
  return p;
}

// Haal data via nieuwe backend endpoint (wordcounts)
async function fetchWordcounts({ base, version = "HSV", mode = "exact", words = [] }) {
  if (!words?.length) return [];
  const qs = new URLSearchParams({ version, mode, words: words.join(",") }).toString();
  const url = `${base}/api/stats/wordcounts?${qs}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json?.data) ? json.data : [];
}

async function renderChart({ base, version, words, mode = "exact", title }) {
  const list = (words || []).filter(Boolean);
  if (!list.length) return { buffer: null, rows: [], words: [] };

  const key = cacheKey({ version, mode, words: list });
  if (chartCache.has(key)) return chartCache.get(key);

  const data = await fetchWordcounts({ base, version, mode, words: list });
  if (!data.length) {
    const empty = { buffer: null, rows: [], words: list };
    chartCache.set(key, empty);
    return empty;
  }

  const ranked = data
    .map((row) => ({ ...row, __total: sumRow(row, list) }))
    .sort((a, b) => b.__total - a.__total)
    .slice(0, 24);

  const labels = ranked.map((r) => r.book);
  const datasets = list.map((w, i) => ({
    label: w,
    backgroundColor: palette[i % palette.length],
    data: ranked.map((r) => Number(r[w]) || 0),
    borderWidth: 0,
  }));

  const cfg = {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 12 } }, title: { display: true, text: title || `Woordfrequentie — ${version}` } },
      scales: { x: { stacked: true, ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } }, y: { stacked: true, beginAtZero: true } },
    },
  };

  const buffer = await chartCanvas.renderToBuffer(cfg, "image/png");
  const out = { buffer, rows: ranked, words: list };
  chartCache.set(key, out);
  return out;
}

// HTML skeleton + DOCX/PDF helpers (ongewijzigd op kernpunten; ingekort)
function styles() { return `
  @page { size: A4; margin: 16mm 14mm 20mm; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif; color:#0f172a; }
  .chart img { width:100%; height:auto; border:1px solid #e2e8f0; border-radius:8px; margin:6px 0; }
  .tbl { border-collapse:collapse; width:100%; font-size:12px; margin-top:6px; }
  .tbl th,.tbl td { border:1px solid #e2e8f0; padding:4px 6px; text-align:left; }
  .tbl th { background:#f8fafc; }
`; }

function htmlSkeleton({ generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"/><title>${esc(TITLE)} — ${esc(BRAND)}</title><style>${styles()}</style></head>
<body>
  <h2>Algemene notities</h2>
  <div>${esc(generalNotes || "—").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>")}</div>

  <h2>Favoriete teksten</h2>
  ${
    (favoritesTexts || []).map(t => `
      <article>
        <div><strong>${esc(t.ref || "")}</strong></div>
        <blockquote><p>${esc(t.text || "").replace(/\n/g, "<br/>")}</p></blockquote>
        ${t.note ? `<div><em>${esc(t.note)}</em></div>` : ""}
      </article>`).join("")
    || `<p>Geen favoriete teksten.</p>`
  }

  <h2>AI-resultaten</h2>
  ${(aiResults || []).map(r => `<article><div><strong>${esc(r.title || "AI-resultaat")}</strong></div>${(new MarkdownIt()).render(r.text || "")}</article>`).join("") || `<p>Nog geen AI-resultaten.</p>`}

  <h2>Favoriete grafieken</h2>
  ${(favoritesCharts || []).map((c,i)=>`
    <article class="card">
    <div><strong>${esc(c.title || ("Grafiek " + (i+1)))}</strong></div>
      <div>Versie: ${esc(c.version || "HSV")} • Woorden: ${esc((c.words || []).join(", "))}</div>
      <div class="chart"><img id="chart-${i}" alt="Grafiek ${i+1}" /></div>
      <div id="chart-table-${i}"></div>
    </article>`).join("") || `<p>Geen favoriete grafieken.</p>`}
</body></html>`.trim();
}

async function buildDocxBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  const children = [
    new Paragraph({ text: BRAND, heading: HeadingLevel.HEADING_3 }),
    new Paragraph({ text: TITLE, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Gegenereerd: ${nowStr()}` }),
    new Paragraph({ text: "Algemene notities", heading: HeadingLevel.HEADING_2 }),
    new Paragraph(generalNotes || "—"),
    new Paragraph({ text: "Favoriete teksten", heading: HeadingLevel.HEADING_2 }),
  ];

  for (const t of (favoritesTexts || [])) {
    children.push(new Paragraph({ text: t.ref || "Tekst", heading: HeadingLevel.HEADING_3 }));
    children.push(new Paragraph(t.text || ""));
    if (t.note) children.push(new Paragraph({ text: `Notitie: ${t.note}` }));
  }
  if (!(favoritesTexts || []).length) children.push(new Paragraph("Geen favoriete teksten."));

  children.push(new Paragraph({ text: "AI-resultaten", heading: HeadingLevel.HEADING_2 }));
  for (const r of (aiResults || [])) {
    children.push(new Paragraph({ text: r.title || "AI-resultaat", heading: HeadingLevel.HEADING_3 }));
    children.push(new Paragraph(r.text || ""));
  }
  if (!(aiResults || []).length) children.push(new Paragraph("Nog geen AI-resultaten."));

  children.push(new Paragraph({ text: "Favoriete grafieken", heading: HeadingLevel.HEADING_2 }));
  for (const c of (favoritesCharts || [])) {
    const png = await renderChart({ base, version: c.version || "HSV", words: c.words || [], title: c.title || `Woordfrequentie — ${c.version || "HSV"}` });
    if (png?.buffer) {
      children.push(new Paragraph({
        children: [new ImageRun({ data: png.buffer, transformation: { width: 600, height: 180 } })],
      }));
    }
    if (png?.rows?.length) {
      const words = (c.words || []).filter(Boolean);
      const head = new TableRow({ children: [new TableCell({ children: [new Paragraph("Boek")] }), ...words.map(w => new TableCell({ children: [new Paragraph(w)] }))] });
      const body = png.rows.slice(0, 12).map(r =>
        new TableRow({ children: [new TableCell({ children: [new Paragraph(r.book)] }), ...words.map(w => new TableCell({ children: [new Paragraph(String(r[w] || 0))] }))] })
      );
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] }));
    }
  }
  if (!(favoritesCharts || []).length) children.push(new Paragraph("Geen favoriete grafieken."));

  const doc = new Document({ sections: [{ children, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`${BRAND} • ${TITLE}`)] })] }) } }] });
  return Packer.toBuffer(doc);
}

async function buildPdfBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  let html = htmlSkeleton({ generalNotes, favoritesTexts, favoritesCharts, aiResults });

  for (let i = 0; i < (favoritesCharts || []).length; i++) {
    const c = favoritesCharts[i];
    try {
      const png = await renderChart({ base, version: c.version || "HSV", words: c.words || [], mode: "exact", title: c.title || `Woordfrequentie — ${c.version || "HSV"}` });
      if (png?.buffer) {
        const b64 = Buffer.from(png.buffer).toString("base64");
        html = html.replace(`<img id="chart-${i}" alt="Grafiek ${i + 1}" />`, `<img id="chart-${i}" alt="Grafiek ${i + 1}" src="data:image/png;base64,${b64}" />`);
      }
      if (png?.rows?.length) {
        const words = (c.words || []).filter(Boolean);
        const head = `<tr><th>Boek</th>${words.map((w) => `<th>${esc(w)}</th>`).join("")}</tr>`;
        const lines = png.rows.slice(0, 12).map((r) => `<tr><td>${esc(r.book)}</td>${words.map((w) => `<td>${Number(r[w] || 0)}</td>`).join("")}</tr>`).join("");
        html = html.replace(`<div id="chart-table-${i}"></div>`, `<table class="tbl">${head}${lines}</table>`);
      }
    } catch (e) {
      console.warn("[export] chart render failed:", e?.message);
    }
  }

  return enqueuePdfJob(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.emulateMediaType("screen");
      await page.setContent(html, { waitUntil: ["load", "domcontentloaded", "networkidle0"] });
      const pdf = await page.pdf({
        format: "A4", printBackground: true,
        margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
        displayHeaderFooter: true, headerTemplate: `<div></div>`,
        footerTemplate: `<div style="font-size:10px; color:#64748b; width:100%; padding:6px 14mm; display:flex; justify-content:space-between;"><span>Bijbelzoek.nl • Studie-export</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      });
      if (!pdf || pdf.length < 800) throw new Error(`PDF buffer te klein (${pdf?.length || 0})`);
      return pdf;
    } finally { await page.close().catch(() => {}); }
  });
}

// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.json({
    ok: true,
    info: "Gebruik POST /api/export/pdf of /api/export/docx met { generalNotes, favoritesTexts, favoritesCharts, aiResults }",
    version: "exporter-v3"
  });
});

router.get("/_version", (_req, res) => {
  res.json({ exporter: "bijbelzoek-v3", ok: true, brand: BRAND, title: TITLE });
});

router.post("/:fmt", async (req, res, next) => {
  try {
    const { fmt } = req.params; // "pdf" | "docx"
    const { generalNotes = "", favoritesTexts = [], favoritesCharts = [], aiResults = [] } = req.body || {};
    const base = getBaseFromReq(req);

    if (fmt === "pdf") {
      const buf = await buildPdfBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults });
      res.setHeader("X-Exporter", "bijbelzoek-v3");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="favorieten.pdf"`);
      res.setHeader("Content-Length", String(buf.length));
      return res.end(buf);
    }

    if (fmt === "docx") {
      const buf = await buildDocxBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults });
      res.setHeader("X-Exporter", "bijbelzoek-v3");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="favorieten.docx"`);
      res.setHeader("Content-Length", String(buf.length));
      return res.end(buf);
    }

    return res.status(400).json({ error: "Onbekend exportformaat. Gebruik /api/export/pdf of /api/export/docx." });
  } catch (e) {
    next(e);
  }
});

export default router;
