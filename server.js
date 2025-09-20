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
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArr = x => Array.isArray(x) ? x : String(x ?? "").split(",").map(s => s.trim()).filter(Boolean);
const makeRegex = (w, mode) => {
  if (mode === "exact") return new RegExp(`\\b${escapeRx(w)}\\b`, "iu"); // woordgrenzen, unicode
  return new RegExp(escapeRx(w), "iu"); // fuzzy: substring
};

// ──────────────────────────────────────────────────────────────
// Search (sluit aan op SearchResults.jsx + doorklik)
app.get("/api/search", async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const mode = String(req.query.mode || "or").toLowerCase(); // standaard OR
    const words = toArr(req.query.words ?? req.query.q);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.resultLimit || req.query.limit) || 20);

    // optionele boekfilter(s)
    const bookParam = req.query.book ?? req.query.books;
    const books = toArr(bookParam);

    if (!words.length) return res.json({ results: [], total: 0 });

    // tekst-criteria
    const textPart = (mode === "and")
      ? { $and: words.map(w => ({ text: makeRegex(w, "exact") })) } // AND = exact per woord
      : (mode === "exact")
        ? { $or: words.map(w => ({ text: makeRegex(w, "exact") })) } // exact maar OR tussen woorden
        : (mode === "fuzzy")
          ? { $or: words.map(w => ({ text: makeRegex(w, "fuzzy") })) } // fuzzy OR
          : { $or: words.map(w => ({ text: makeRegex(w, "fuzzy") })) }; // default OR (fuzzy)

    // basisfilter
    const filter = { version };
    // merge mode
    if (textPart.$and) filter.$and = [{ version }, ...textPart.$and];
    else Object.assign(filter, textPart);

    // boekfilter
    if (books.length === 1) {
      filter.book = books[0]; // exact match op boeknaam
    } else if (books.length > 1) {
      filter.book = { $in: books };
    }

    const [total, docs] = await Promise.all([
      Verse.countDocuments(filter),
      Verse.find(filter)
        .sort({ book: 1, chapter: 1, verse: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    res.json({
      version, mode, words, books,
      total, page, resultLimit: limit,
      results: docs.map(v => ({
        ref: `${v.book ?? "Onbekend"} ${v.chapter}:${v.verse}`,
        book: v.book ?? null,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text
      }))
    });
  } catch (e) {
    console.error("search error:", e);
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
