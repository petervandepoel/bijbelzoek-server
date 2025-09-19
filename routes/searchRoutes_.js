import express from "express";
import BibleVerse from "../models/BibleVerse.js";
import { wordRegex } from "../utils/diacritics.js";


const router = express.Router();

/** Escape regex meta-tekens */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const q = (req.query.q || "").trim();
  const mode = (req.query.mode || "exact").toLowerCase();
  const book = (req.query.book || "").trim();
  const limit = Number.parseInt(req.query.limit || "50", 10);
  const debug = req.query.debug === "1";

  if (!q) return res.json({ results: [] });

  try {
    // meerdere zoekwoorden toestaan, gescheiden door komma
    const words = q
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    if (words.length === 0) return res.json({ results: [] });

    // bouw $or-condities per woord
    const orConditions = words.map((w) => {
      const esc = escapeRe(w);
      if (mode === "fuzzy") {
        return { text: { $regex: esc, $options: "i" } }; // match overal in woord
      } else {
        return { text: { $regex: `\\b${esc}\\b`, $options: "i" } }; // alleen exact
      }
    });

    const conditions = { version, $or: orConditions };
    if (book) conditions.book = book;

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

    if (debug) {
      console.log(" results count:", results.length);
    }

    res.json({
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
