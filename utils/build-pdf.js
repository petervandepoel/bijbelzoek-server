import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import "dayjs/locale/nl.js";
import { splitLines, normalizeText, decodeDataUrl, parseAiProse } from "./text.js";

dayjs.locale("nl");

const ACCENT = "#4F46E5";
const ACCENT_LIGHT = "#EEF2FF";
const MUTED  = "#6B7280";

const H1 = 22;
const H2 = 16;
const H3 = 13;
const BODY = 11;

// Handige helpers
function contentBox(doc) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  return { x, w, bottom };
}
function ensureSpace(doc, needed = 120) {
  const { bottom } = contentBox(doc);
  if (doc.y + needed > bottom) doc.addPage();
}
function sectionHeader(doc, title) {
  ensureSpace(doc, 40);
  const { x, w } = contentBox(doc);
  const h = 28;
  doc.save();
  doc.roundedRect(x, doc.y, w, h, 6).fillColor(ACCENT_LIGHT).fill();
  doc.fillColor(ACCENT).fontSize(H1).text(title, x + 10, doc.y + 6);
  doc.restore();
  doc.moveDown(1.2);
}
function heading(doc, text, size = H2, color = ACCENT) {
  ensureSpace(doc, 24);
  doc.fillColor(color).fontSize(size).text(text, { align: "left" }).moveDown(0.3).fillColor("black");
}
function para(doc, text, size = BODY, color = "black") {
  ensureSpace(doc, 16);
  doc.fontSize(size).fillColor(color).text(text, { align: "left" }).moveDown(0.2).fillColor("black");
}
function notesBox(doc, label = "Extra aantekeningen", height = 110) {
  ensureSpace(doc, height + 36);
  const { x, w } = contentBox(doc);
  const y = doc.y + 8;
  doc.fontSize(10).fillColor(MUTED).text(label, x, doc.y, { align: "left" });
  doc.roundedRect(x, y + 16, w, height, 6).strokeColor(MUTED).lineWidth(0.8).stroke();
  doc.y = y + 16 + height + 16;
  doc.fillColor("black");
}
function titlePage(doc, { theme }) {
  doc.addPage({ margins: { top: 72, bottom: 72, left: 72, right: 72 } });
  doc.fillColor(ACCENT).fontSize(30).text(theme, { align: "center" }).moveDown(1);
  doc.fillColor(MUTED).fontSize(14).text("gegenereerd met Bijbelzoek.nl", { align: "center" }).moveDown(0.5);
  doc.fillColor(MUTED).fontSize(12).text(dayjs().format("D MMMM YYYY"), { align: "center" }).fillColor("black");
  doc.addPage();
}

function captionHeight(doc, text, maxWidth) {
  if (!text) return 0;
  // hoogte van de caption op basis van daadwerkelijke tekstbreedte
  return doc.heightOfString(text, { width: maxWidth, align: "left" }) + 6;
}

function chartCaption(doc, labelText) {
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(MUTED).text(labelText, { align: "left" });
  doc.fillColor("black");
  doc.moveDown(0.4);
}

async function renderChart(doc, c) {
  const { x, w: contentW, bottom } = contentBox(doc);

  // Doel: volle contentbreedte gebruiken voor leesbaarheid
  const srcW = Number(c?.docxWidth || 640);
  const srcH = Number(c?.docxHeight || 360);
  const scale = Math.min(contentW / srcW, 1.35); // iets ruimer toegestaan
  const outW = Math.round(srcW * scale);
  const outH = Math.round(srcH * scale);

  // Caption-tekst (labels) — als fallback als de PNG labels zou missen
  const words = Array.isArray(c?.words) ? c.words.filter(Boolean) : [];
  const labelsText = words.length ? `Labels: ${words.join(" · ")}` : "";
  const capH = captionHeight(doc, labelsText, contentW);

  // Ruimteplanner: afbeelding + caption + marge
  const needed = outH + capH + 24;
  if (doc.y + needed > bottom) doc.addPage();

  // Teken afbeelding op huidige y en verschuif y erna
  const dataUrl = c?.imageData || c?.dataUrl || c?.png || c?.image || null;
  if (dataUrl) {
    const decoded = decodeDataUrl(dataUrl);
    if (decoded?.buffer) {
      // Plaats expliciet op (x, y)
      const yStart = doc.y;
      doc.image(decoded.buffer, x, yStart, { width: outW, height: outH });
      // cursor onder de afbeelding
      doc.y = yStart + outH + 6;

      if (labelsText) chartCaption(doc, labelsText);
      return;
    }
  }

  para(doc, "Grafiekgegevens ontbreken.", 10, MUTED);
}

export async function buildPdfBuffer(payload = {}, { theme }) {
  return await new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false });
      const chunks = [];
      doc.on("data", (d) => chunks.push(d));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      titlePage(doc, { theme: theme || "Bijbelstudie" });

      // ===== AI-resultaten =====
      const ai = Array.isArray(payload.aiResults) ? payload.aiResults : [];
      if (ai.length) {
        sectionHeader(doc, "AI-resultaten");
        const groups = { preek: [], bijbelstudie: [], liederen: [], actueelmedia: [] };
        ai.forEach(r => { const k = (r.kind || "").toLowerCase(); if (groups[k]) groups[k].push(r); });

        const order = ["preek","bijbelstudie","liederen","actueelmedia"];
        const labels = { preek: "Preek", bijbelstudie: "Bijbelstudie", liederen: "Liederen", actueelmedia: "Nieuws & Media" };

        for (const k of order) {
          const list = groups[k]; if (!list.length) continue;
          heading(doc, labels[k], H2);
          list.forEach(r => {
            const headingTitle = r?.structured?.title || r?.title || null;
            if (headingTitle) heading(doc, headingTitle, H3);

            const parsed = parseAiProse(r?.text || "");
            const summary = r?.structured?.summary || parsed.summary;
            if (summary) para(doc, summary, BODY, MUTED);

            const outline = r?.structured?.outline;
            if (Array.isArray(outline) && outline.length) {
              outline.forEach(sec => {
                const head = sec?.kop || sec?.title || "-";
                heading(doc, head, H3, MUTED);
                (sec?.opsomming || sec?.punten || sec?.inhoud || sec?.points || []).forEach(pt => para(doc, `• ${String(pt)}`));
              });
            } else {
              (parsed.sections || []).forEach(sec => {
                heading(doc, sec.title || "-", H3, MUTED);
                (sec.items || []).forEach(pt => para(doc, `• ${pt}`));
              });
            }

            const scriptures = r?.structured?.scriptures || r?.structured?.passages || r?.structured?.bijbelteksten || parsed.scriptures;
            if (Array.isArray(scriptures) && scriptures.length) {
              heading(doc, "Centrale gedeelten", H3, MUTED);
              scriptures.forEach(s => {
                para(doc, s.ref || "-", BODY);
                if (s.text) para(doc, s.text, 10, MUTED);
              });
            }

            const questions = r?.structured?.questions || r?.structured?.vragen || parsed.questions;
            if (Array.isArray(questions) && questions.length) {
              heading(doc, "Gespreksvragen", H3, MUTED);
              questions.forEach(q => para(doc, `• ${q}`));
            }

            const known = new Set(["title","summary","outline","news","media","scriptures","passages","bijbelteksten","questions","vragen","theme","kind"]);
            if (r && r.structured) {
              for (const [key, val] of Object.entries(r.structured)) {
                if (known.has(key)) continue;
                if (Array.isArray(val) && val.length) {
                  heading(doc, key.charAt(0).toUpperCase()+key.slice(1), H3, MUTED);
                  val.forEach(item => para(doc, typeof item === "string" ? `• ${item}` : `• ${JSON.stringify(item)}`));
                } else if (typeof val === "string" && val.trim()) {
                  heading(doc, key.charAt(0).toUpperCase()+key.slice(1), H3, MUTED);
                  splitLines(val).forEach(line => para(doc, line));
                }
              }
            }

            if (r?.text) {
              const txt = String(r.text).trim();
              if (txt) {
                heading(doc, "Overige tekst", H3, MUTED);
                splitLines(txt).forEach(line => { if (line.trim()) para(doc, line); });
              }
            }
          });
        }
      }

      // ===== Teksten =====
      const texts = Array.isArray(payload.favoritesTexts) ? payload.favoritesTexts : payload.favTexts;
      if (texts && texts.length) {
        sectionHeader(doc, "Teksten");
        notesBox(doc, "Extra aantekeningen — Teksten");
        texts.forEach(t => {
          heading(doc, t?.ref || "Tekst", H2);
          if (t?.text) splitLines(t.text).forEach(line => para(doc, line));
          if (t?.note) para(doc, `Notitie: ${normalizeText(t.note)}`, 10, MUTED);
        });
      }

      // ===== Grafieken =====
      const charts = Array.isArray(payload.favoritesCharts) ? payload.favoritesCharts : payload.favCharts;
      if (Array.isArray(charts) && charts.length) {
        sectionHeader(doc, "Grafieken");
        notesBox(doc, "Extra aantekeningen — Grafieken");

        for (let i = 0; i < charts.length; i++) {
          const c = charts[i];

          // renderChart zorgt nu zélf voor page-break & y-advance
          await renderChart(doc, c);

          if (c?.note) para(doc, `Notitie: ${normalizeText(c.note)}`, 10, MUTED);

          // lucht tussen grafieken + soft page planning
          const { bottom } = contentBox(doc);
          if (doc.y + 60 > bottom) doc.addPage();
          else doc.moveDown(0.8);
        }
      }

      doc.end();
    } catch (e) { reject(e); }
  });
}
