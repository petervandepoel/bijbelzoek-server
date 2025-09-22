// server/routes/searchRoutes.js
import express from "express";
import BibleVerse from "../models/BibleVerse.js";

const router = express.Router();

// Diacritics map: elke basisletter dekt ook varianten met accenten
const diacriticMap = {
  a: "[aàáâãäå]",
  e: "[eèéêë]",
  i: "[iìíîï]",
  o: "[oòóôõö]",
  u: "[uùúûü]",
  y: "[yýÿ]",
  c: "[cç]",
  n: "[nñ]"
};

// Bouw regex die accenten negeert
function wordRegex(word, mode = "exact") {
  const escaped = word
    .split("")
    .map((ch) =>
      diacriticMap[ch.toLowerCase()]
        ? diacriticMap[ch.toLowerCase()]
        : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("");

  if (mode === "exact") return `\\b${escaped}\\b`;
  return escaped;
}

router.get("/", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const q = (req.query.q || req.query.words || "").trim();
  const mode = (req.query.mode || "exact").toLowerCase();
  const book = (req.query.book || "").trim();
  const limitRaw = Number.parseInt(req.query.limit || req.query.resultLimit || "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

  if (!q) {
    return res.json({ version, mode, words: [], book, total: 0, results: [] });
  }

  try {
    const words = q.split(",").map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) {
      return res.json({ version, mode, words: [], book, total: 0, results: [] });
    }

    // OR-condities voor de woorden
    const orConditions = words.map((w) => {
      const pattern = wordRegex(w, mode);
      return { text: { $regex: new RegExp(pattern, "i") } };
    });

    // Combineer in $and zodat boekfilter altijd meegaat
    const conditions = { $and: [{ version }, { $or: orConditions }] };

    if (book) {
      conditions.$and.push({ book: { $regex: new RegExp(`^${book}$`, "i") } });
    }

    // Forceer projectie → altijd de velden die we willen
    const results = await BibleVerse.find(
      conditions,
      "book chapter verse text ref version"
    )
      .limit(limit)
      .sort({ book: 1, chapter: 1, verse: 1 })
      .lean();

    res.json({
      version,
      mode,
      words,
      book,
      total: results.length,
      results: results.map((r) => ({
        _id: r._id,
        version: r.version,
        book: r.book || "Onbekend",
        chapter: r.chapter,
        verse: r.verse,
        text: r.text,
        ref: r.ref || `${r.book || "Onbekend"} ${r.chapter}:${r.verse}`
      }))
    });
  } catch (err) {
    console.error("❌ search error:", err);
    res.status(500).json({ error: "search mislukt" });
  }
});

export default router;
