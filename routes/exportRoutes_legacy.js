import express from "express";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

const router = express.Router();

router.post("/pdf", (req, res) => {
  const { generalNotes = "", favoritesTexts = [], favoritesCharts = [] } = req.body;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=favorieten.pdf");

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text("Bijbelzoek Favorieten", { align: "center" });
  doc.moveDown();

  if (generalNotes) {
    doc.fontSize(16).text("📝 Algemene notities", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11).text(generalNotes);
    doc.moveDown();
  }

  if (favoritesTexts.length) {
    doc.fontSize(16).text("⭐ Teksten", { underline: true });
    doc.moveDown(0.4);
    favoritesTexts.forEach((t, i) => {
      doc.fontSize(12).text(t.ref || "", { continued: false });
      if (t.note) doc.fontSize(10).fillColor("#6366f1").text(`Notitie: ${t.note}`).fillColor("black");
      doc.fontSize(11).text(t.text || "");
      if (i < favoritesTexts.length - 1) doc.moveDown(0.4);
    });
    doc.moveDown();
  }

  if (favoritesCharts.length) {
    doc.fontSize(16).text("📊 Grafieken", { underline: true });
    doc.moveDown(0.4);
    favoritesCharts.forEach((c, i) => {
      doc.fontSize(12).text(c.title || "Grafiek");
      if (c.note) doc.fontSize(10).fillColor("#6366f1").text(`Notitie: ${c.note}`).fillColor("black");
      doc.fontSize(11).text(`Versie: ${c.version} — Woorden: ${(c.words||[]).join(", ")}`);
      if (i < favoritesCharts.length - 1) doc.moveDown(0.4);
    });
  }

  doc.end();
});

router.post("/docx", async (req, res) => {
  const { generalNotes = "", favoritesTexts = [], favoritesCharts = [] } = req.body;

  const children = [];

  children.push(new Paragraph({
    text: "Bijbelzoek Favorieten",
    heading: HeadingLevel.TITLE
  }));

  if (generalNotes) {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ text: "Algemene notities", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: generalNotes }));
  }

  if (favoritesTexts.length) {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ text: "Teksten", heading: HeadingLevel.HEADING_1 }));
    favoritesTexts.forEach((t) => {
      children.push(new Paragraph({ text: t.ref || "" }));
      if (t.note) children.push(new Paragraph({ text: `Notitie: ${t.note}` }));
      children.push(new Paragraph({ text: t.text || "" }));
    });
  }

  if (favoritesCharts.length) {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ text: "Grafieken", heading: HeadingLevel.HEADING_1 }));
    favoritesCharts.forEach((c) => {
      children.push(new Paragraph({ children: [
        new TextRun({ text: c.title || "Grafiek", bold: true })
      ]}));
      if (c.note) children.push(new Paragraph({ text: `Notitie: ${c.note}` }));
      children.push(new Paragraph({ text: `Versie: ${c.version} — Woorden: ${(c.words||[]).join(", ")}` }));
    });
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", "attachment; filename=favorieten.docx");
  res.send(Buffer.from(buffer));
});

export default router;
