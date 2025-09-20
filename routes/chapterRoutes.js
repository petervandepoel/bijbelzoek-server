import express from "express";
import mongoose from "mongoose";

const router = express.Router();

// Gebruik het al-geregistreerde Verse model uit server.js
let Verse;
try {
  Verse = mongoose.model("Verse");
} catch {
  // Fallback (zou normaal nooit nodig zijn als server.js eerst laadt)
  const verseSchema = new mongoose.Schema({
    version: String, book: String, chapter: Number, verse: Number, text: String
  }, { versionKey: false });
  Verse = mongoose.model("Verse", verseSchema, "verses");
}

router.get("/", async (req, res) => {
  const version = String(req.query.version || "HSV").toUpperCase();
  const book = (req.query.book || "").trim();
  const chapter = Number(req.query.chapter || 1);

  if (!book) return res.status(400).json({ error: "book is verplicht" });

  try {
    const verses = await Verse.find({ version, book, chapter }).sort({ verse: 1 }).lean();
    res.json({ verses });
  } catch (err) {
    console.error("chapter error:", err);
    res.status(500).json({ error: "Chapter ophalen mislukt" });
  }
});

export default router;
