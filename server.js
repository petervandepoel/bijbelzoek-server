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
const DB_NAME = process.env.DB_NAME || "bijbelzoek";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt");
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGIN || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : undefined, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ---------- Health ----------
app.get("/healthz", async (req, res) => {
  try {
    const ping = await mongoose.connection.db.admin().ping();
    res.json({ ok: true, uptime: process.uptime(), db: mongoose.connection.db.databaseName, ping });
  } catch {
    res.json({ ok: true, uptime: process.uptime() });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- Import project routes ----------
import searchRoutes from "./routes/searchRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import chapterRoutes from "./routes/chapterRoutes.js";
import exportRoutes from "./routes/export.js";
import ai from "./routes/ai.js";
import analyticsRouter from "./routes/analytics.js";
import feedbackRouter from "./routes/feedback.js";

app.use("/api/search", searchRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/chapter", chapterRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/ai", ai);
app.use("/api/analytics", analyticsRouter);
app.use("/api/feedback", feedbackRouter);
console.log("[server] API-routes mounted");

// ---------- Schema / Inline fallback ----------
const verseSchema = new mongoose.Schema({
  version: { type: String, index: true },
  book: { type: String, index: true },
  chapter: { type: Number, index: true },
  verse: { type: Number, index: true },
  text: { type: String, required: true }
}, { versionKey: false });

verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 }, { unique: true });
verseSchema.index({ text: "text" });
const Verse = mongoose.model("Verse", verseSchema, "verses");

// kleine helpers
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArr = x => Array.isArray(x) ? x : String(x ?? "").split(",").map(s => s.trim()).filter(Boolean);

// ---------- Fallback endpoints ----------
app.get("/api/versions-fallback", async (_req, res) => {
  const versions = await Verse.distinct("version");
  res.json({ versions });
});
app.get("/api/debug/smoke", async (_req, res) => {
  const total = await Verse.estimatedDocumentCount();
  const sample = await Verse.find({ version: "HSV", text: /God/i })
    .select({ _id: 0, book: 1, chapter: 1, verse: 1, text: 1 })
    .limit(5).lean();
  res.json({ db: mongoose.connection.db.databaseName, total, sampleCount: sample.length, sample });
});

// ---------- Missers loggen ----------
app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    console.log("[MISS]", req.method, req.originalUrl);
  }
  next();
});

// ---------- Error handlers ----------
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

// ---------- Boot ----------
(async () => {
  try {
    // Let op: forceren van DB_NAME!
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    await Verse.syncIndexes();

    const count = await Verse.estimatedDocumentCount();
    console.log(`✅ MongoDB verbonden (${DB_NAME}) — verses: ${count}`);

    if (count === 0) {
      console.error("⚠️ Database is leeg! Check of je wel naar /bijbelzoek seedt.");
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server luistert op http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("❌ DB connect error:", e.message);
    process.exit(1);
  }
})();
