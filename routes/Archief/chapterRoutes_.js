import express from "express";
import BibleVerse from "../models/BibleVerse.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const book = (req.query.book || "").trim();
  const chapter = parseInt(req.query.chapter || "1", 10);

  if (!book) return res.status(400).json({ error: "book is verplicht" });

  try {
    const verses = await BibleVerse.find({ version, book, chapter })
      .sort({ verse: 1 });
    res.json({ verses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chapter ophalen mislukt" });
  }
});

export default router;
