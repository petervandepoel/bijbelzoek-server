// server/scripts/seed.js
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "bijbelzoek";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI ontbreekt");
  process.exit(1);
}

const verseSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, index: true }, // "HSV" | "NKJV"
    book: { type: String, required: true, index: true },
    chapter: { type: Number, required: true },
    verse: { type: Number, required: true },
    text: { type: String, required: true }
  },
  { versionKey: false }
);

// Unieke sleutel per vers
verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 }, { unique: true });
// Tekst-zoekindex (basis)
verseSchema.index({ text: "text" });

const Verse = mongoose.model("Verse", verseSchema, "verses");

async function loadVersion(filePath, version) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error(`JSON moet een array zijn: ${filePath}`);

  const ops = rows.map((v) => ({
    updateOne: {
      filter: {
        version,
        book: v.book,
        chapter: Number(v.chapter),
        verse: Number(v.verse)
      },
      update: {
        $set: {
          version,
          book: v.book,
          chapter: Number(v.chapter),
          verse: Number(v.verse),
          text: v.text
        }
      },
      upsert: true
    }
  }));

  console.log(`→ Seeding ${version} (${ops.length} verzen)`);
  const chunkSize = 1000;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    await Verse.bulkWrite(chunk, { ordered: false });
    process.stdout.write(`  ${Math.min(i + chunkSize, ops.length)}/${ops.length}\r`);
  }
  console.log(`\n✔ ${version} klaar`);
}

(async () => {
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log("✅ Verbonden met Atlas");

  const dataDir = path.join(__dirname, "..", "data");
  const hsv = path.join(dataDir, "hsv.json");
  const nkjv = path.join(dataDir, "nkjv.json");

  const tasks = [];
  if (fs.existsSync(hsv)) tasks.push(loadVersion(hsv, "HSV"));
  if (fs.existsSync(nkjv)) tasks.push(loadVersion(nkjv, "NKJV"));
  if (tasks.length === 0) throw new Error(`Geen datafiles in ${dataDir}`);

  await Promise.all(tasks);

  // Indexen aanmaken/valideren
  await Verse.syncIndexes();

  const total = await Verse.estimatedDocumentCount();
  console.log(`📦 Totaal docs: ${total}`);

  await mongoose.disconnect();
  console.log("🎉 Seeding gereed");
  process.exit(0);
})().catch((e) => {
  console.error("❌ Seed error:", e.message);
  process.exit(1);
});
