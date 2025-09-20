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

// ---------- ENV ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = (process.env.DB_NAME || "bijbelzoek").trim();
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGIN || "")
  .split(",").map(s => s.trim()).filter(Boolean);

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt");
  process.exit(1);
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : undefined,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ---------- Health ----------
app.get("/healthz", async (_req, res) => {
  try {
    const ping = await mongoose.connection.db.admin().ping();
    res.json({ ok: true, uptime: process.uptime(), db: mongoose.connection.db.databaseName, ping });
  } catch {
    res.json({ ok: true, uptime: process.uptime() });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- Schema (same as when search worked) ----------
const verseSchema = new mongoose.Schema({
  version: { type: String, index: true },  // "HSV" | "NKJV" etc.
  book:    { type: String, index: true },
  chapter: { type: Number, index: true },
  verse:   { type: Number, index: true },
  text:    { type: String, required: true }
}, { versionKey: false });

// Important indexes
verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 }, { unique: true });
verseSchema.index({ text: "text" });

// Use the exact collection name we seeded into:
const Verse = mongoose.model("Verse", verseSchema, "verses");

// ---------- Helpers ----------
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArr = x => Array.isArray(x) ? x : String(x ?? "").split(",").map(s => s.trim()).filter(Boolean);

// ---------- Inline CORE API (this was the “working” search) ----------
app.get("/api/search", handleSearch);
app.post("/api/search", handleSearch);

async function handleSearch(req, res) {
  try {
    const q = { ...req.query, ...req.body };
    const version = String(q.version || "HSV").toUpperCase();
    const mode    = String(q.mode || "exact").toLowerCase();
    const words   = toArr(q.words ?? q.word ?? q.q);
    const page    = Math.max(1, parseInt(q.page) || 1);
    const limit   = Math.min(50, parseInt(q.resultLimit) || 20);

    if (!words.length) return res.status(400).json({ error: "words required" });

    // Build AND of regexes per word on "text" + fixed version
    const and = [{ version }];
    for (const w of words) {
      const rx = mode === "exact"
        ? new RegExp(`\\b${escapeRx(w)}\\b`, "i")
        : new RegExp(escapeRx(w), "i");
      and.push({ text: rx });
    }

    const [total, docs] = await Promise.all([
      Verse.countDocuments({ $and: and }),
      Verse.find({ $and: and })
        .sort({ book: 1, chapter: 1, verse: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    res.json({
      version, mode, words, total, page, resultLimit: limit,
      results: docs.map(v => ({
        ref: `${v.book} ${v.chapter}:${v.verse}`,
        book: v.book, chapter: v.chapter, verse: v.verse, text: v.text
      }))
    });
  } catch (e) {
    console.error("search error:", e);
    res.status(500).json({ error: "internal_error" });
  }
}

// Stats: both spellings supported
app.get(["/api/stats/hits-by-book", "/api/stats/hitsByBook"], async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const word = (req.query.word || (req.query.words || "").split(",")[0] || "").trim();
    if (!word) return res.status(400).json({ error: "word required" });

    const rx = new RegExp(`\\b${escapeRx(word)}\\b`, "i");
    const data = await Verse.aggregate([
      { $match: { version, text: rx } },
      { $group: { _id: "$book", hits: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({ version, word, data });
  } catch (e) {
    console.error("stats error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// Versions
app.get("/api/versions", async (_req, res) => {
  const versions = await Verse.distinct("version");
  res.json({ versions });
});

// Debug: quick smoke
app.get("/api/debug/smoke", async (_req, res) => {
  const total = await Verse.estimatedDocumentCount();
  const sample = await Verse.find({ version: "HSV", text: /God/i })
    .select({ _id: 0, book: 1, chapter: 1, verse: 1, text: 1 })
    .limit(5).lean();
  res.json({ db: mongoose.connection.db.databaseName, total, sampleCount: sample.length, sample });
});

// ---------- Other project routes (kept) ----------
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
console.log("[server] Extra routes mounted");

// ---------- Missed API log (helps spot typos) ----------
app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    console.log("[MISS]", req.method, req.originalUrl);
  }
  next();
});

// ---------- 404 & Error ----------
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

// ---------- Boot (force DB_NAME, prove data) ----------
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    await Verse.syncIndexes();

    // Loud diagnostics so you see the real DB instantly
    const count = await Verse.estimatedDocumentCount();
    const versions = await Verse.distinct("version");
    console.log(`✅ MongoDB verbonden (${mongoose.connection.db.databaseName}) — verses: ${count}, versions: ${versions.join(", ") || "(none)"}`);

    if (count === 0) {
      console.warn("⚠️ 0 verses in collection. Dit is meestal: verkeerde DB in URI of seed niet (meer) gedaan.");
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server luistert op http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("❌ DB connect error:", e.message);
    process.exit(1);
  }
})();
