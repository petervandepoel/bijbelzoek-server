// scripts/seedBibleFixed.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Verse from "../models/BibleVerse.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  try {
    if (!process.env.MONGODB_URI) {
      console.error("❌ MONGODB_URI ontbreekt");
      process.exit(1);
    }

    console.log("✅ Verbinden met MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI, { dbName: "bijbelzoek" });

    console.log("🗑️ Oude data verwijderen...");
    await Verse.deleteMany({});

    // Helper om JSON te laden
    const loadJson = (fname) => {
      const p = path.join(__dirname, "../data", fname);
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    };

    // HSV
    const hsvData = loadJson("hsv.json");
    const hsvVerses = hsvData
      .filter((v) => v.book && v.text) // skip lege records
      .map((v) => ({
        book: String(v.book),
        chapter: Number(v.chapter),
        verse: Number(v.verse),
        text: String(v.text),
        version: "HSV",
        ref: `${v.book} ${v.chapter}:${v.verse}`,
      }));

    // NKJV
    const nkjvData = loadJson("nkjv.json");
    const nkjvVerses = nkjvData
      .filter((v) => v.book && v.text)
      .map((v) => ({
        book: String(v.book),
        chapter: Number(v.chapter),
        verse: Number(v.verse),
        text: String(v.text),
        version: "NKJV",
        ref: `${v.book} ${v.chapter}:${v.verse}`,
      }));

    console.log(`📥 Invoegen HSV (${hsvVerses.length}) + NKJV (${nkjvVerses.length})...`);
    await Verse.insertMany([...hsvVerses, ...nkjvVerses]);

    console.log("✅ Seeding voltooid!");
  } catch (err) {
    console.error("❌ Seed error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Verbinding gesloten");
  }
}

seed();
