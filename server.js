// server.js
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = (process.env.DB_NAME || "bijbelzoek").trim();

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt");
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGIN || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ──────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : undefined, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ──────────────────────────────────────────────────────────────
// Model
// ──────────────────────────────────────────────────────────────
let Verse;
try {
  Verse = mongoose.model("Verse");
} catch {
  const verseSchema = new mongoose.Schema({
    version: { type: String, index: true },
    book:    { type: String, index: true },
    chapter: { type: Number, index: true },
    verse:   { type: Number, index: true },
    text:    { type: String, required: true },
  }, { versionKey: false });

  verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 }, { unique: true });
  verseSchema.index({ text: "text" });

  Verse = mongoose.model("Verse", verseSchema, "verses");
}

// Helpers bovenin server.js
const escapeRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Basisletter → karakterklasse met accenten (bidirectioneel)
const DIA = {
  a: "aàáâãäå",
  e: "eèéêë",
  i: "iìíîï",
  o: "oòóôõö",
  u: "uùúûü",
  y: "yýÿ",
  c: "cç",
  n: "nñ",
};

const toArr = x => Array.isArray(x) ? x : String(x ?? "").split(",").map(s => s.trim()).filter(Boolean);

function makeRegex(word, mode = "exact") {
  const body = buildDiacriticPattern(word);
  return mode === "exact"
    ? new RegExp(`\\b${body}\\b`, "i")
    : new RegExp(body, "i");
}

// ──────────────────────────────────────────────────────────────
app.get("/api/search", async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const mode = String(req.query.mode || "or").toLowerCase();

    // q -> words alias
    if (!req.query.words && req.query.q) req.query.words = req.query.q;

    // woorden
    let words = [];
    if (typeof req.query.words === "string") {
      words = req.query.words.split(",").map(w => w.trim()).filter(Boolean);
    } else if (Array.isArray(req.query.words)) {
      words = req.query.words.map(w => String(w).trim()).filter(Boolean);
    }

    // boek(en)
    let books = [];
    const rawBook = req.query.book ?? req.query.books;
    if (typeof rawBook === "string") {
      books = rawBook.split(",").map(b => b.trim()).filter(Boolean);
    } else if (Array.isArray(rawBook)) {
      books = rawBook.map(b => String(b).trim()).filter(Boolean);
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.resultLimit || req.query.limit) || 20);

    if (!words.length) {
      return res.json({ version, mode, words: [], books, total: 0, page, resultLimit: limit, results: [] });
    }

    // Tekst-deel van de query (default: OR + exact; fuzzy blijft fuzzy)
    let textPart;
    if (mode === "and") {
      textPart = { $and: words.map(w => ({ text: makeRegex(w, "exact") })) };
    } else if (mode === "fuzzy") {
      textPart = { $or: words.map(w => ({ text: makeRegex(w, "fuzzy") })) };
    } else {
      // "exact" of onbekend => OR exact
      textPart = { $or: words.map(w => ({ text: makeRegex(w, "exact") })) };
    }

    // Basisfilter altijd via $and, zodat boekfilter gegarandeerd mee-werkt
    const filter = { $and: [{ version }] };
    if (textPart.$and) filter.$and.push(...textPart.$and);
    if (textPart.$or)  filter.$and.push({ $or: textPart.$or });

    // Boekfilter: case-insensitive exact (ondersteunt meerdere boeken)
    if (books.length === 1) {
      filter.$and.push({ book: new RegExp(`^${escapeRx(books[0])}$`, "i") });
    } else if (books.length > 1) {
      filter.$and.push({ book: { $in: books.map(b => new RegExp(`^${escapeRx(b)}$`, "i")) } });
    }

    // Query met expliciete projectie; zo hebben we altijd book/chapter/verse/text
    const [total, docs] = await Promise.all([
      Verse.countDocuments(filter),
      Verse.find(filter, "book chapter verse text version") // 'ref' bouwen we zelf
        .sort({ book: 1, chapter: 1, verse: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    res.json({
      version, mode, words, books, total, page, resultLimit: limit,
      results: docs.map(v => {
        const book = v.book && v.book.trim() ? v.book : "Onbekend";
        const ref  = `${book} ${v.chapter}:${v.verse}`;
        return { ref, book, chapter: v.chapter, verse: v.verse, text: v.text };
      })
    });
  } catch (e) {
    console.error("❌ search error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});





// ──────────────────────────────────────────────────────────────
// Stats (sluit aan op FilterPanel.jsx en WordFrequencyChart.jsx)
// ──────────────────────────────────────────────────────────────
app.get(["/api/stats/hits-by-book", "/api/stats/hitsByBook"], async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const word = (req.query.word || (req.query.words || "").split(",")[0] || "").trim();
    const mode = String(req.query.mode || "or").toLowerCase();
    if (!word) return res.json({ version, word, data: [] });

    const rx = makeRegex(word, mode);
    const data = await Verse.aggregate([
      { $match: { version, book: { $ne: null }, text: rx } },
      { $group: { _id: "$book", hits: { $sum: 1 } } },
      { $project: { _id: 0, book: "$_id", hits: 1 } },
      { $sort: { book: 1 } }
    ]);

    res.json({ version, word, data });
  } catch (e) {
    console.error("stats error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/stats/wordcounts", async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const words = toArr(req.query.words);
    const mode = String(req.query.mode || "or").toLowerCase();
    if (!words.length) return res.json({ version, data: [] });

    const groupStage = { _id: "$book" };
    for (const w of words) {
      const rx = makeRegex(w, mode);
      groupStage[w] = {
        $sum: { $cond: [{ $regexMatch: { input: "$text", regex: rx } }, 1, 0] }
      };
    }

    const rows = await Verse.aggregate([
      { $match: { version, book: { $ne: null } } },
      { $group: groupStage },
      { $project: { _id: 0, book: "$_id", ...Object.fromEntries(words.map(w => [w, `$${w}`])) } },
      { $sort: { book: 1 } }
    ]);

    res.json({ version, mode, words, data: rows });
  } catch (e) {
    console.error("wordcounts error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ──────────────────────────────────────────────────────────────
// Versions & debug
// ──────────────────────────────────────────────────────────────
app.get("/api/versions", async (_req, res) => {
  const versions = await Verse.distinct("version");
  res.json({ versions });
});

app.get("/api/debug/smoke", async (_req, res) => {
  const total = await Verse.estimatedDocumentCount();
  const sample = await Verse.find({ version: "HSV", text: /God/i })
    .select({ _id: 0, book: 1, chapter: 1, verse: 1, text: 1 }).limit(5).lean();
  res.json({ db: mongoose.connection.db.databaseName, total, sampleCount: sample.length, sample });
});

// ──────────────────────────────────────────────────────────────
// Projectroutes
// ──────────────────────────────────────────────────────────────
import chapterRoutes from "./routes/chapterRoutes.js";
import exportRoutes from "./routes/export.js";
import ai from "./routes/ai.js";
import analyticsRouter from "./routes/analytics.js";
import feedbackRouter from "./routes/feedback.js";

app.use("/api/chapter", chapterRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/ai", ai);
app.use("/api/analytics", analyticsRouter);
app.use("/api/feedback", feedbackRouter);

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    await Verse.syncIndexes();

    const count = await Verse.estimatedDocumentCount();
    console.log(`✅ MongoDB verbonden (${mongoose.connection.db.databaseName}) — verses: ${count}`);

    app.listen(PORT, () => console.log(`🚀 Server luistert op http://localhost:${PORT}`));
  } catch (e) {
    console.error("❌ DB connect error:", e.message);
    process.exit(1);
  }
})();
