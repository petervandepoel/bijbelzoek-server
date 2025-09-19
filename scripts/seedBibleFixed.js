import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import BibleVerse from "../models/BibleVerse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hsvFile = path.join(__dirname, "../data/bible_hsv_fixed.json");
const nkjvFile = path.join(__dirname, "../data/bible_nkjv_fixed.json");

async function seed() {
  try {
    await mongoose.connect("mongodb://127.0.0.1:27017/bijbelzoek");
    console.log("✅ Verbonden met MongoDB");

    await BibleVerse.deleteMany({});
    console.log("🗑️ Oude data verwijderd");

    const hsvData = JSON.parse(fs.readFileSync(hsvFile, "utf-8"));
    const hsvVerses = hsvData.map((v) => ({
      ...v,
      version: "HSV",
      ref: `${v.book} ${v.chapter}:${v.verse}`,
    }));

    const nkjvData = JSON.parse(fs.readFileSync(nkjvFile, "utf-8"));
    const nkjvVerses = nkjvData.map((v) => ({
      ...v,
      version: "NKJV",
      ref: `${v.book} ${v.chapter}:${v.verse}`,
    }));

    await BibleVerse.insertMany([...hsvVerses, ...nkjvVerses]);
    console.log(
      `📥 ${hsvVerses.length} HSV verzen + ${nkjvVerses.length} NKJV verzen toegevoegd`
    );

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
}

seed();
