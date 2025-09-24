import express from "express";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import PDFDocument from "pdfkit";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";

const router = express.Router();

// Chart renderer (PNG buffer)
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 600, height: 400 });

async function renderChart(data) {
  const config = {
    type: "bar",
    data: {
      labels: Object.keys(data),
      datasets: [
        {
          label: "Favorieten",
          data: Object.values(data),
        },
      ],
    },
    options: { plugins: { legend: { display: false } } },
  };
  return await chartJSNodeCanvas.renderToBuffer(config);
}

// -------- PDF --------
async function buildPdf(data) {
  const buffers = [];
  const doc = new PDFDocument({ margin: 40 });
  doc.on("data", buffers.push.bind(buffers));
  return new Promise(async (resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text(data.export_title, { align: "center" });
    doc.moveDown().fontSize(10).text(`Gegenereerd: ${data.generated_at}`);

    doc.addPage().fontSize(12).text("AI-resultaten", { underline: true });
    data.ai_results.forEach((item) => {
      doc.moveDown().fontSize(11).text(item.title, { bold: true });
      doc.moveDown(0.2).fontSize(10).text(item.summary);
    });

    doc.addPage().fontSize(12).text("Teksten", { underline: true });
    data.texts.forEach((t) => {
      doc.moveDown().fontSize(11).text(t.ref, { bold: true });
      doc.moveDown(0.2).fontSize(10).text(t.text);
    });

    // Chart as image
    const chartImg = await renderChart(data.chart.data);
    doc.addPage().fontSize(12).text(data.chart.title, { underline: true });
    doc.image(chartImg, { fit: [450, 300], align: "center" });

    doc.end();
  });
}

// -------- DOCX --------
async function buildDocx(data) {
  const chartImg = await renderChart(data.chart.data);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: data.export_title, heading: HeadingLevel.TITLE }),
          new Paragraph(`Gegenereerd: ${data.generated_at}`),
          new Paragraph({ text: "AI-resultaten", heading: HeadingLevel.HEADING_1 }),
          ...data.ai_results.flatMap((item) => [
            new Paragraph({ text: item.title, heading: HeadingLevel.HEADING_2 }),
            new Paragraph(item.summary),
          ]),
          new Paragraph({ text: "Teksten", heading: HeadingLevel.HEADING_1 }),
          ...data.texts.flatMap((t) => [
            new Paragraph({ text: t.ref, heading: HeadingLevel.HEADING_2 }),
            new Paragraph(t.text),
          ]),
          new Paragraph({ text: "Grafiek", heading: HeadingLevel.HEADING_1 }),
        ],
      },
    ],
  });

  // Chart afbeelding toevoegen
  doc.addSection({
    children: [
      new Paragraph(data.chart.title),
      // afbeelding wordt achteraf ingesloten
    ],
  });

  const PackerWithImage = async () => {
    const { ImageRun } = await import("docx");
    doc.Sections[doc.Sections.length - 1].children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: chartImg,
            transformation: { width: 400, height: 250 },
          }),
        ],
      })
    );
    return await Packer.toBuffer(doc);
  };

  return await PackerWithImage();
}

// -------- Route --------
router.post("/export", async (req, res) => {
  const { filename_base, include, data } = req.body;

  try {
    if (include?.pdf) {
      const pdf = await buildPdf(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename_base}.pdf"`);
      return res.send(pdf);
    }
    if (include?.docx) {
      const docx = await buildDocx(data);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename_base}.docx"`);
      return res.send(docx);
    }
    res.status(400).send("No export type selected.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Export failed.");
  }
});

export default router;
