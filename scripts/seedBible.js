import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import BibleVerse from "../models/BibleVerse.js";

dotenv.config();
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bijbelzoek";

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Verbonden met MongoDB");

  const filePath = path.resolve("./data/bible_hsv.json");
  if (!fs.existsSync(filePath)) {
    console.log("⚠️ hsv.json niet gevonden in ./data. Plaats je HSV JSON daar.");
    process.exit(0);
  }
  const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const version = "HSV";

  const docs = json.map(v => ({ ...v, version, ref: `${v.book} ${v.chapter}:${v.verse}` }));

  await BibleVerse.deleteMany({ version });
  await BibleVerse.insertMany(docs);

  console.log(`✅ ${docs.length} verzen geladen in ${version}`);
  mongoose.disconnect();
}

seed();
