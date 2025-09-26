import express from "express";
import dayjs from "dayjs";
import { buildDocxBuffer } from "../utils/build-docx.js";
import { buildPdfBuffer } from "../utils/build-pdf.js";
import { deriveTheme, makeFilename } from "../utils/text.js";

const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true }));

async function handleExport(req, res, type) {
  try {
    const payload = req.body || {};
    const theme = deriveTheme(payload);
    const dateStr = dayjs().format("YYYY_MM_DD");
    const filename = makeFilename(theme, dateStr, type);

    let buffer;
    if (type === "docx") {
      buffer = await buildDocxBuffer(payload, { theme, dateStr });
      res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } else {
      buffer = await buildPdfBuffer(payload, { theme, dateStr });
      res.setHeader("Content-Type","application/pdf");
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (e) {
    console.error("[EXPORT ERROR]", e);
    res.status(500).json({ error: e?.message || "Export failed" });
  }
}

router.post("/docx", (req, res) => handleExport(req, res, "docx"));
router.post("/pdf",  (req, res) => handleExport(req, res, "pdf"));

export default router;