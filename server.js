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
app.use(express.urlencoded({ extended: false }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ──────────────────────────────────────────────────────────────
// Health
// ──────────────────────────────────────────────────────────────
app.get("/healthz", async (_req, res) => {
  try {
    const ping = await mongoose.connection.db.admin().ping();
    res.json({ ok: true, uptime: process.uptime(), db: mongoose.connection.db.databaseName, ping });
  } catch {
    res.json({ ok: true, uptime: process.uptime() });
  }
});

// ──────────────────────────────────────────────────────────────
// Verse model (OverwriteModelError fix)
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

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArr = x => Array.isArray(x) ? x : String(x ?? "").split(",").map(s => s.trim()).filter(Boolean);

// ──────────────────────────────────────────────────────────────
// Stats endpoints
// ──────────────────────────────────────────────────────────────

// ✅ 1. hitsByBook (frontend FilterPanel gebruikt dit)
app.get(["/api/stats/hits-by-book", "/api/stats/hitsByBook"], async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const word = (req.query.word || (req.query.words || "").split(",")[0] || "").trim();
    if (!word) return res.status(400).json({ error: "word required" });

    const rx = new RegExp(`\\b${escapeRx(word)}\\b`, "i");
    const data = await Verse.aggregate([
      { $match: { version, book: { $ne: null }, text: rx } },
      { $group: { _id: "$book", hits: { $sum: 1 } } },
      { $project: { _id: 0, book: "$_id", hits: 1 } },   // ← fix: frontend verwacht "book"
      { $sort: { book: 1 } }
    ]);

    res.json({ version, word, data });
  } catch (e) {
    console.error("stats error:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ✅ 2. wordcounts (frontend WordFrequencyChart gebruikt dit)
app.get("/api/stats/wordcounts", async (req, res) => {
  try {
    const version = String(req.query.version || "HSV").toUpperCase();
    const words = toArr(req.query.words);
    const mode = String(req.query.mode || "exact").toLowerCase();
    if (!words.length) return res.json({ version, data: [] });

    const groupStage = { _id: "$book" };
    for (const w of words) {
      const rx = mode === "exact" ? new RegExp(`\\b${escapeRx(w)}\\b`, "i") : new RegExp(escapeRx(w), "i");
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
// Import project routes (chapter, export, ai, analytics, feedback)
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
