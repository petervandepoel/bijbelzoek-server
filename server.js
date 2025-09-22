// server.js
import express from "express";
import mongoose from "mongoose";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";

import Verse from "./models/BibleVerse.js";
import chapterRoutes from "./routes/chapterRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import exportRoutes from "./routes/export.js";
import aiRoutes from "./routes/ai.js";
import analyticsRoutes from "./routes/analytics.js";
import feedbackRoutes from "./routes/feedback.js";

dotenv.config();
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan("dev"));

// ──────────────────────────────────────────────────────────────
// Mongo connect
// ──────────────────────────────────────────────────────────────
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI, { dbName: "bijbelzoek" })
  .then(() => console.log("✅ Mongo verbonden"))
  .catch((err) => {
    console.error("❌ Mongo connectie fout:", err);
    process.exit(1);
  });

// ──────────────────────────────────────────────────────────────
// Helpers voor zoekfunctie
// ──────────────────────────────────────────────────────────────
const DIA = {
  a: "[aàáâãäå]",
  e: "[eèéêë]",
  i: "[iìíîï]",
  o: "[oòóôõö]",
  u: "[uùúûü]",
};

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeWord(w) {
  return w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function expandDiacritics(word) {
  return word
    .split("")
    .map(ch => DIA[ch.toLowerCase()] || ch)
    .join("");
}

function makeRegex(word, mode = "exact") {
  const pattern = expandDiacritics(word);
  if (mode === "fuzzy") return new RegExp(pattern, "i");
  return new RegExp(`\\b${pattern}\\b`, "i");
}

function toArr(x) {
  return Array.isArray(x)
    ? x
    : String(x ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

// ──────────────────────────────────────────────────────────────
// /api/search
// ──────────────────────────────────────────────────────────────
app.get("/api/search", async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const mode = String(req.query.mode || "or").toLowerCase();

    if (!req.query.words && req.query.q) req.query.words = req.query.q;
    const words = toArr(req.query.words);
    const books = toArr(req.query.book ?? req.query.books);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(
      50,
      parseInt(req.query.resultLimit || req.query.limit) || 20
    );

    if (!words.length) {
      return res.json({
        version,
        mode,
        words: [],
        books,
        total: 0,
        page,
        resultLimit: limit,
        results: [],
      });
    }

    // OR-condities voor woorden
    const orConditions = words.map((w) => ({
      text: makeRegex(w, mode),
    }));

    // Basisfilter met $and
    const filter = { $and: [{ version }, { $or: orConditions }] };

    // Boekfilter (AND)
    if (books.length === 1) {
      filter.$and.push({ book: new RegExp(`^${escapeRx(books[0])}$`, "i") });
    } else if (books.length > 1) {
      filter.$and.push({
        book: { $in: books.map((b) => new RegExp(`^${escapeRx(b)}$`, "i")) },
      });
    }

    const [total, docs] = await Promise.all([
      Verse.countDocuments(filter),
      Verse.find(filter, "book chapter verse text version")
        .sort({ book: 1, chapter: 1, verse: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const results = docs.map((v) => {
      const book = v.book && v.book.trim() ? v.book : "Onbekend";
      return {
        ref: `${book} ${v.chapter}:${v.verse}`,
        book,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text,
      };
    });

    res.json({
      version,
      mode,
      words,
      books,
      total,
      page,
      resultLimit: limit,
      results,
    });
  } catch (e) {
    console.error("❌ search error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ──────────────────────────────────────────────────────────────
// Extra routes
// ──────────────────────────────────────────────────────────────
app.use("/api/chapter", chapterRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/feedback", feedbackRoutes);

// Health check
app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Debug smoke test
app.get("/api/debug/smoke", async (req, res) => {
  try {
    const total = await Verse.countDocuments();
    const sample = await Verse.find().limit(5).lean();
    res.json({
      db: mongoose.connection.name,
      total,
      sampleCount: sample.length,
      sample,
    });
  } catch (e) {
    res.status(500).json({ error: "smoke_failed" });
  }
});

// ──────────────────────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server draait op poort ${PORT}`);
});
