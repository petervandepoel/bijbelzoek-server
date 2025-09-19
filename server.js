// server.js
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import mongoose from "mongoose";

// ---------- ENV ----------
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI; // moet /bijbelzoek bevatten!
const DB_NAME = process.env.DB_NAME || "bijbelzoek";
const SELF_TEST = process.env.SELF_TEST === "1"; // zet tijdelijk aan voor boot-test
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---------- App ----------
const app = express();
app.set("trust proxy", true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : undefined, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// ---------- DB ----------
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt (tip: gebruik ...mongodb.net/BIJBELZOEK?...).");
  process.exit(1);
}

const verseSchema = new mongoose.Schema({
  version: { type: String, index: true },  // HSV/NKJV
  book:    { type: String, index: true },
  chapter: { type: Number, index: true },
  verse:   { type: Number, index: true },
  text:    { type: String, required: true }
}, { versionKey: false });

verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 }, { unique: true });
verseSchema.index({ text: "text" });

const Verse = mongoose.model("Verse", verseSchema, "verses");

// ---------- Helpers ----------
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArr = x => Array.isArray(x) ? x : String(x ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---------- Routes ----------
app.get("/healthz", async (req, res) => {
  try {
    const ping = await mongoose.connection.db.admin().ping();
    res.json({ ok: true, uptime: process.uptime(), db: mongoose.connection.db.databaseName, ping });
  } catch {
    res.json({ ok: true, uptime: process.uptime() }); // DB kan even wegvallen zonder health fail
  }
});

// Flexibele SEARCH: GET én POST, words|word|q, exact|fuzzy
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

// Stats-ALIAS: accepteert beide paden & param varianten
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

// Unieke versies
app.get("/api/versions", async (req, res) => {
  const versions = await Verse.distinct("version");
  res.json({ versions });
});

// Debug rooktest
app.get("/api/debug/smoke", async (req, res) => {
  const total = await Verse.estimatedDocumentCount();
  const sample = await Verse.find({ version: "HSV", text: /God/i })
    .select({ _id: 0, book: 1, chapter: 1, verse: 1, text: 1 })
    .limit(5).lean();
  res.json({ db: mongoose.connection.db.databaseName, total, sampleCount: sample.length, sample });
});

// 404 JSON (alleen na alle routes)
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// ---------- Boot ----------
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    await Verse.syncIndexes();

    // Mini-DB proof
    const count = await Verse.estimatedDocumentCount();
    console.log(`✅ MongoDB verbonden (${mongoose.connection.db.databaseName}) — verses: ${count}`);

    app.listen(PORT, () => {
      console.log(`🚀 Server luistert op http://localhost:${PORT}`);
      if (SELF_TEST) runSelfTest(PORT).catch(err => console.error("SELF_TEST error:", err));
    });
  } catch (e) {
    console.error("❌ DB connect error:", e.message);
    process.exit(1);
  }
})();

// ---------- Self-test (logs naar Render) ----------
async function runSelfTest(port) {
  // Node 18+ heeft global fetch
  const base = `http://127.0.0.1:${port}`;

  // 1) healthz
  const h = await fetch(`${base}/healthz`).then(r => r.text());
  console.log("SELF/healthz:", h);

  // 2) search GET
  const s = await fetch(`${base}/api/search?version=HSV&words=God&mode=exact&resultLimit=3`)
    .then(r => r.text());
  console.log("SELF/search (GET):", s);

  // 3) search POST
  const p = await fetch(`${base}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: "HSV", mode: "exact", words: ["God"], page: 1, resultLimit: 3 })
  }).then(r => r.text());
  console.log("SELF/search (POST):", p);

  // 4) stats
  const st = await fetch(`${base}/api/stats/hits-by-book?version=HSV&word=God`).then(r => r.text());
  console.log("SELF/stats:", st);

  // 5) versions
  const v = await fetch(`${base}/api/versions`).then(r => r.text());
  console.log("SELF/versions:", v);
}
