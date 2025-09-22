// server/routes/searchRoutes.js
import express from "express";
import BibleVerse from "../models/BibleVerse.js";
import { wordRegex } from "../utils/diacritics.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const q = (req.query.q || req.query.words || "").trim(); // support q= en words=
  const mode = (req.query.mode || "exact").toLowerCase(); // "exact" | "fuzzy"
  const book = (req.query.book || "").trim();
  const limitRaw = Number.parseInt(req.query.limit || req.query.resultLimit || "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;
  const debug = req.query.debug === "1";

  if (!q) return res.json({ results: [] });

  try {
    const words = q
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    if (words.length === 0) return res.json({ results: [] });

    // regex conditions per woord
    const orConditions = words.map((w) => {
      const pattern = wordRegex(w, mode); 
      return { text: { $regex: new RegExp(pattern, "i") } }; // echte RegExp
    });

    const conditions = { version, $or: orConditions };

    if (book) {
      conditions.book = { $regex: new RegExp(`^${book}$`, "i") }; // case-insensitive exact
    }

    if (debug) {
      console.log("🔎 SEARCH DEBUG");
      console.log(" version:", version);
      console.log(" mode:", mode);
      console.log(" words:", words);
      console.log(" conditions:", JSON.stringify(conditions, null, 2));
    }

    const results = await BibleVerse.find(conditions)
      .limit(limit)
      .sort({ chapter: 1, verse: 1 });

    res.json({
      version,
      mode,
      words,
      book,
      total: results.length,
      results: results.map((r) => ({
        _id: r._id,
        version: r.version,
        book: r.book,
        chapter: r.chapter,
        verse: r.verse,
        text: r.text,
        ref: r.ref,
      })),
    });
  } catch (err) {
    console.error("❌ search error:", err);
    res.status(500).json({ error: "search mislukt" });
  }
});

export default router;
