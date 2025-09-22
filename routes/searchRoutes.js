import express from "express";
import BibleVerse from "../models/BibleVerse.js";

// Diacritics map
const diacriticMap = {
  a: "[aàáâãäå]",
  e: "[eèéêë]",
  i: "[iìíîï]",
  o: "[oòóôõö]",
  u: "[uùúûü]",
  y: "[yýÿ]",
  c: "[cç]",
  n: "[nñ]",
  ë: "[eèéêë]",
  ï: "[iìíîï]",
  ö: "[oòóôõö]",
  ü: "[uùúûü]",
  á: "[aàáâãäå]",
  é: "[eèéêë]",
  í: "[iìíîï]",
  ó: "[oòóôõö]",
  ú: "[uùúûü]"
};

// Regex builder
function wordRegex(word, mode = "exact") {
  const escaped = word
    .split("")
    .map((ch) => diacriticMap[ch.toLowerCase()] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("");

  if (mode === "exact") return `\\b${escaped}\\b`;
  return escaped;
}

const router = express.Router();

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

    // bouw OR-condities
    const orConditions = words.map((w) => {
      const pattern = wordRegex(w, mode);
      return { text: { $regex: new RegExp(pattern, "i") } };
    });

    // combineer alles in $and
    const conditions = { $and: [{ version }, { $or: orConditions }] };

    if (book) {
      conditions.$and.push({ book: { $regex: new RegExp(`^${book}$`, "i") } });
    }

    const results = await BibleVerse.find(conditions)
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
