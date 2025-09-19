// server/routes/export.js
import { Router } from "express";
import MarkdownIt from "markdown-it";
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  Table, TableRow, TableCell, WidthType, ImageRun, Footer, AlignmentType
} from "docx";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import "chart.js/auto"; // registreert alle controllers/scales/plugins
import puppeteer from "puppeteer";

const router = Router();

// ───────────────────────────────────────────────────────────────────────────────
// Config & helpers
// ───────────────────────────────────────────────────────────────────────────────
const BRAND = "Bijbelzoek.nl";
const TITLE = "Studie-export";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const CHART_W = 1600; // hoger voor scherpte
const CHART_H = 460;
const chartCanvas = new ChartJSNodeCanvas({
  width: CHART_W,
  height: CHART_H,
  backgroundColour: "#ffffff",
});

const palette = [
  "#4f46e5","#f59e0b","#10b981","#ef4444","#14b8a6",
  "#a855f7","#3b82f6","#ec4899","#84cc16","#fb923c",
];

const nowStr = () =>
  new Date().toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" });

const esc = (s = "") => String(s).replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
const sumRow = (row, words) => words.reduce((a, w) => a + (Number(row[w]) || 0), 0);

function getBaseFromReq(req) {
  const host = req.get("host"); // bv. localhost:5000
  const proto = req.protocol || "http";
  return `${proto}://${host}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Patch 1 + 2 infra: cache, singleton browser, wachtrij
// ───────────────────────────────────────────────────────────────────────────────
const chartCache = new Map();
const cacheKey = ({ version, mode = "exact", words = [] }) =>
  `${version}|${mode}|${[...(words || [])].sort().join(",")}`;

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    // netjes afsluiten bij exit
    process.on("exit", async () => (await browserPromise)?.close().catch(() => {}));
  }
  return browserPromise;
}

// simpele wachtrij (1 tegelijk; verhoog desgewenst naar 2–3 door meerdere queues)
let pdfQueue = Promise.resolve();
function enqueuePdfJob(job) {
  const run = () => job().catch((e) => { throw e; });
  const p = pdfQueue.then(run, run);
  pdfQueue = p.catch(() => {}); // keten blijft leven bij error
  return p;
}

// ───────────────────────────────────────────────────────────────────────────────
// Data ophalen (zelfde endpoint als frontend)
// ───────────────────────────────────────────────────────────────────────────────
async function fetchWordcounts({ base, version = "HSV", mode = "exact", words = [] }) {
  if (!words?.length) return [];
  const qs = new URLSearchParams({ version, mode, words: words.join(",") }).toString();
  const url = `${base}/api/stats/wordcounts?${qs}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json?.data) ? json.data : [];
}

// ───────────────────────────────────────────────────────────────────────────────
// Chart → PNG  (Patch 1: cache toegepast)
// ───────────────────────────────────────────────────────────────────────────────
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
      plugins: {
        legend: { position: "top", labels: { boxWidth: 12 } },
        title: { display: true, text: title || `Woordfrequentie — ${version}` },
      },
      scales: {
        x: { stacked: true, ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } },
        y: { stacked: true, beginAtZero: true },
      },
    },
  };

  const buffer = await chartCanvas.renderToBuffer(cfg, "image/png");
  const out = { buffer, rows: ranked, words: list };
  chartCache.set(key, out);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// HTML/CSS voor PDF
// ───────────────────────────────────────────────────────────────────────────────
function styles() {
  return `
  @page { size: A4; margin: 16mm 14mm 20mm; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif; color:#0f172a; }
  .top { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px; }
  .brand { font-weight:800; color:#4f46e5; letter-spacing:.2px; }
  .title { font-weight:900; font-size:28px; }
  .meta { color:#475569; font-size:12px; margin-bottom:18px; }
  h2 { font-size:18px; font-weight:800; border-bottom:2px solid #e2e8f0; padding-bottom:4px; margin:20px 0 10px; }
  h3 { font-size:15px; font-weight:700; margin:12px 0 6px; }
  p { line-height: 1.55; }
  .muted { color:#64748b; }
  .card { border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin:10px 0; background:#fff; }
  .ref { color:#4f46e5; font-weight:700; }
  blockquote { margin:8px 0; padding-left:12px; border-left:3px solid #e5e7eb; }
  .small { font-size:12px; color:#475569; }
  .ai .md h1,.ai .md h2,.ai .md h3 { margin-top:12px; }
  .ai .md ul { padding-left:18px; }
  .ai .md li { margin:2px 0; }
  .chart img { width:100%; height:auto; border:1px solid #e2e8f0; border-radius:8px; margin:6px 0; }
  .tbl { border-collapse:collapse; width:100%; font-size:12px; margin-top:6px; }
  .tbl th,.tbl td { border:1px solid #e2e8f0; padding:4px 6px; text-align:left; }
  .tbl th { background:#f8fafc; }
  `;
}

function htmlSkeleton({ generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  return `
<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<title>${esc(TITLE)} — ${esc(BRAND)}</title>
<style>${styles()}</style>
</head>
<body>
  <div class="top">
    <div class="brand">${esc(BRAND)}</div>
    <div class="title">${esc(TITLE)}</div>
  </div>
  <div class="meta">Gegenereerd: ${esc(nowStr())} • bron: ${esc(BRAND)}</div>

  <h2>Algemene notities</h2>
  <div class="card">
    ${
      (generalNotes && esc(generalNotes).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>")) ||
      "<p class='muted'>—</p>"
    }
  </div>

  <h2>Favoriete teksten</h2>
  ${
    Array.isArray(favoritesTexts) && favoritesTexts.length
      ? favoritesTexts
          .map(
            (t) => `
    <article class="card">
      <div class="ref">${esc(t.ref || "")}</div>
      <blockquote><p>${esc(t.text || "").replace(/\n/g, "<br/>")}</p></blockquote>
      ${t.note ? `<div class="small"><em>${esc(t.note)}</em></div>` : ""}
    </article>`
          )
          .join("")
      : `<p class="muted">Geen favoriete teksten.</p>`
  }

  <h2>AI-resultaten</h2>
  ${
    Array.isArray(aiResults) && aiResults.length
      ? aiResults
          .map(
            (r) => `
    <article class="card ai">
      <div class="small" style="font-weight:700">${esc(r.title || "AI-resultaat")}</div>
      <div class="md">${md.render(r.text || "")}</div>
    </article>`
          )
          .join("")
      : `<p class="muted">Nog geen AI-resultaten.</p>`
  }

  <h2>Favoriete grafieken</h2>
  ${
    Array.isArray(favoritesCharts) && favoritesCharts.length
      ? favoritesCharts
          .map(
            (c, i) => `
    <article class="card">
      <div class="small" style="font-weight:700">${esc(c.title || `Grafiek ${i + 1}`)}</div>
      <div class="small">Versie: ${esc(c.version || "HSV")} • Woorden: ${esc((c.words || []).join(", "))}</div>
      <div class="chart"><img id="chart-${i}" alt="Grafiek ${i + 1}" /></div>
      <div id="chart-table-${i}"></div>
      ${c.note ? `<div class="small"><em>${esc(c.note)}</em></div>` : ""}
    </article>`
          )
          .join("")
      : `<p class="muted">Geen favoriete grafieken.</p>`
  }
</body>
</html>
`.trim();
}

// ───────────────────────────────────────────────────────────────────────────────
// DOCX opbouw (behoudt bestaande functionaliteit + 1 section fix)
// ───────────────────────────────────────────────────────────────────────────────
function mdToDocx(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) { out.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 })); continue; }
    if (line.startsWith("## "))  { out.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 })); continue; }
    if (line.startsWith("# "))   { out.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 })); continue; }
    if (/^[-*]\s+/.test(line))   { out.push(new Paragraph({ text: line.replace(/^[-*]\s+/, ""), bullet: { level: 0 } })); continue; }
    if (/^\d+\.\s+/.test(line))  { out.push(new Paragraph({ text: line.replace(/^\d+\.\s+/, ""), numbering: { reference: "ol", level: 0 } })); continue; }
    out.push(new Paragraph(line));
  }
  return out;
}

async function buildDocxBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  const children = [];

  // Kop + meta
  children.push(new Paragraph({ text: BRAND, heading: HeadingLevel.HEADING_3 }));
  children.push(new Paragraph({ text: TITLE, heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ text: `Gegenereerd: ${nowStr()}`, spacing: { after: 200 } }));

  // Algemene notities
  children.push(new Paragraph({ text: "Algemene notities", heading: HeadingLevel.HEADING_2 }));
  children.push(new Paragraph(generalNotes || "—"));

  // Favoriete teksten
  children.push(new Paragraph({ text: "Favoriete teksten", heading: HeadingLevel.HEADING_2 }));
  if (Array.isArray(favoritesTexts) && favoritesTexts.length) {
    for (const t of favoritesTexts) {
      children.push(new Paragraph({ text: t.ref || "Tekst", heading: HeadingLevel.HEADING_3 }));
      children.push(new Paragraph(t.text || ""));
      if (t.note) {
        children.push(new Paragraph({ text: `Notitie: ${t.note}`, spacing: { after: 200 } }));
      } else {
        children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
      }
    }
  } else {
    children.push(new Paragraph("Geen favoriete teksten."));
  }

  // AI-resultaten
  children.push(new Paragraph({ text: "AI-resultaten", heading: HeadingLevel.HEADING_2 }));
  if (Array.isArray(aiResults) && aiResults.length) {
    for (const r of aiResults) {
      children.push(new Paragraph({ text: r.title || "AI-resultaat", heading: HeadingLevel.HEADING_3 }));
      children.push(...mdToDocx(r.text || ""));
    }
  } else {
    children.push(new Paragraph("Nog geen AI-resultaten."));
  }

  // Grafieken
  children.push(new Paragraph({ text: "Favoriete grafieken", heading: HeadingLevel.HEADING_2 }));
  if (Array.isArray(favoritesCharts) && favoritesCharts.length) {
    for (const c of favoritesCharts) {
      children.push(new Paragraph({ text: c.title || "Grafiek", heading: HeadingLevel.HEADING_3 }));

      let png = null;
      try {
        png = await renderChart({
          base,
          version: c.version || "HSV",
          words: c.words || [],
          title: c.title || `Woordfrequentie — ${c.version || "HSV"}`,
        });
      } catch {}

      if (png?.buffer) {
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: png.buffer,
                transformation: { width: 600, height: 180 },
              }),
            ],
          })
        );
      }

      if (png?.rows?.length) {
        const words = (c.words || []).filter(Boolean);
        const headCells = [new TableCell({ children: [new Paragraph("Boek")] })]
          .concat(words.map((w) => new TableCell({ children: [new Paragraph(w)] })));
        const head = new TableRow({ children: headCells });

        const top = png.rows.slice(0, 12);
        const body = top.map((r) => {
          const cells = [new TableCell({ children: [new Paragraph(r.book)] })]
            .concat(words.map((w) => new TableCell({ children: [new Paragraph(String(r[w] || 0))] })));
          return new TableRow({ children: cells });
        });

        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] }));
      }

      if (c.note) children.push(new Paragraph({ text: `Notitie: ${c.note}` }));
    }
  } else {
    children.push(new Paragraph("Geen favoriete grafieken."));
  }

  const doc = new Document({
    sections: [
      {
        children,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun(`${BRAND} • ${TITLE}`)],
              }),
            ],
          }),
        },
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return buf;
}

// ───────────────────────────────────────────────────────────────────────────────
// PDF bouwen met Puppeteer (Patch 2: queue + singleton browser)
// ───────────────────────────────────────────────────────────────────────────────
async function buildPdfBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults }) {
  let html = htmlSkeleton({ generalNotes, favoritesTexts, favoritesCharts, aiResults });

  // Charts injecteren (fouttolerant + cache)
  const charts = favoritesCharts || [];
  for (let i = 0; i < charts.length; i++) {
    const c = charts[i];
    try {
      const png = await renderChart({
        base,
        version: c.version || "HSV",
        words: c.words || [],
        mode: "exact",
        title: c.title || `Woordfrequentie — ${c.version || "HSV"}`,
      });

      if (png?.buffer) {
        const b64 = Buffer.from(png.buffer).toString("base64");
        html = html.replace(
          `<img id="chart-${i}" alt="Grafiek ${i + 1}" />`,
          `<img id="chart-${i}" alt="Grafiek ${i + 1}" src="data:image/png;base64,${b64}" />`
        );
      }

      if (png?.rows?.length) {
        const words = (c.words || []).filter(Boolean);
        const head = `<tr><th>Boek</th>${words.map((w) => `<th>${esc(w)}</th>`).join("")}</tr>`;
        const lines = png.rows
          .slice(0, 12)
          .map((r) => `<tr><td>${esc(r.book)}</td>${words.map((w) => `<td>${Number(r[w] || 0)}</td>`).join("")}</tr>`)
          .join("");
        const table = `<table class="tbl">${head}${lines}</table>`;
        html = html.replace(`<div id="chart-table-${i}"></div>`, table);
      }
    } catch (e) {
      console.warn("[export] chart render failed:", e?.message);
    }
  }

  // Bouw PDF in wachtrij + gebruik gedeelde browser
  return enqueuePdfJob(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      await page.emulateMediaType("screen");
      await page.setContent(html, { waitUntil: ["load", "domcontentloaded", "networkidle0"] });

      // Fonts/layout netjes laten uitrenderen
      try { await page.evaluate(async () => document.fonts && (await document.fonts.ready)); } catch {}
      try { await page.waitForNetworkIdle({ idleTime: 100, timeout: 1500 }); } catch {}

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
        displayHeaderFooter: true,
        headerTemplate: `<div></div>`,
        footerTemplate: `
          <div style="font-size:10px; color:#64748b; width:100%; padding:6px 14mm; display:flex; justify-content:space-between;">
            <span>Bijbelzoek.nl • Studie-export</span>
            <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
          </div>`,
      });

      if (!pdf || pdf.length < 800) throw new Error(`PDF buffer te klein (${pdf?.length || 0})`);
      return pdf;
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────────
router.get("/_version", (req, res) => {
  res.json({ exporter: "bijbelzoek-v3", ok: true, brand: BRAND, title: TITLE });
});

router.post("/:fmt", async (req, res, next) => {
  try {
    const { fmt } = req.params; // "pdf" | "docx"
    const {
      generalNotes = "",
      favoritesTexts = [],
      favoritesCharts = [],
      aiResults = [],
      // ontvangen van client; handig maar niet strikt nodig:
      version = "HSV",
      searchMode = "exact",
    } = req.body || {};

    const base = getBaseFromReq(req);

    if (fmt === "pdf") {
      try {
        const buf = await buildPdfBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults });
        res.setHeader("X-Exporter", "bijbelzoek-v3");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="favorieten.pdf"`);
        res.setHeader("Content-Length", String(buf.length)); // Patch 3
        return res.end(buf);
      } catch (e) {
        console.error("[export] PDF build failed:", e?.stack || e?.message);
        return res.status(500).json({ error: "PDF-generation-failed", message: e?.message || "unknown" });
      }
    }

    if (fmt === "docx") {
      try {
        const buf = await buildDocxBuffer({ base, generalNotes, favoritesTexts, favoritesCharts, aiResults });
        res.setHeader("X-Exporter", "bijbelzoek-v3");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="favorieten.docx"`);
        res.setHeader("Content-Length", String(buf.length));
        return res.end(buf);
      } catch (e) {
        console.error("[export] DOCX build failed:", e?.stack || e?.message);
        return res.status(500).json({ error: "DOCX-generation-failed", message: e?.message || "unknown" });
      }
    }

    return res.status(400).json({ error: "Onbekend exportformaat. Gebruik /api/export/pdf of /api/export/docx." });
  } catch (e) {
    next(e);
  }
});

export default router;
