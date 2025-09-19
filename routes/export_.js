import { Router } from "express";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

export const router = Router();

// Eenvoudige text-flattener
function flatten({ generalNotes, favoritesTexts=[], favoritesCharts=[], aiResults=[], composed }) {
  const lines = [];
  lines.push(`# Export — ${new Date().toLocaleDateString()}`);

  if (generalNotes) lines.push("\n## Algemene notities\n" + generalNotes);

  if (favoritesTexts.length) {
    lines.push("\n## ⭐ Teksten");
    favoritesTexts.forEach(t => lines.push(`\n**${t.ref || ''}**\n${t.text || ''}`));
  }

  if (favoritesCharts.length) {
    lines.push("\n## 📊 Grafieken");
    favoritesCharts.forEach(c => lines.push(`- ${c.title || (c.words||[]).join(', ')}`));
  }

  if (aiResults.length) {
    lines.push("\n## 🧠 AI Resultaten");
    aiResults.forEach(r => lines.push(`\n### ${r.title}\n${r.text}`));
  }

  if (composed) lines.push("\n## 📋 Samengesteld document\n" + composed);
  return lines.join("\n");
}

/** PDF */
router.post("/pdf", async (req,res) => {
  const text = flatten(req.body || {});
  const pdf = await PDFDocument.create();
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontSize = 11;
  const margin = 40;

  let page = pdf.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;
  const maxWidth = width - margin*2;

  function newPage() {
    page = pdf.addPage();
    ({ width, height } = page.getSize());
    y = height - margin;
  }
  function addLine(str) {
    page.drawText(str, { x: margin, y, size: fontSize, font: times });
    y -= 14;
    if (y < margin) newPage();
  }

  // simpele word-wrap
  const words = text.split(/\s+/);
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const lineWidth = times.widthOfTextAtSize(test, fontSize);
    if (lineWidth > maxWidth) {
      if (line) addLine(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) addLine(line);

  const bytes = await pdf.save();
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition","attachment; filename=favorieten.pdf");
  res.send(Buffer.from(bytes));
});

/** DOCX */
router.post("/docx", async (req,res) => {
  const text = flatten(req.body || {});
  const paras = text.split(/\n+/).map((t)=> new Paragraph({
    text: t.replace(/^#\s*/,"").replace(/^##\s*/,""),
    heading: t.startsWith("# ") ? HeadingLevel.HEADING_1 :
             t.startsWith("## ") ? HeadingLevel.HEADING_2 : undefined
  }));
  const doc = new Document({ sections: [{ properties:{}, children: paras }] });
  const buf = await Packer.toBuffer(doc);
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition","attachment; filename=favorieten.docx");
  res.send(buf);
});

export default router;
