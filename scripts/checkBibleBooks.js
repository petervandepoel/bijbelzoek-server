import mongoose from "mongoose";
import { fileURLToPath } from "url";
import path from "path";
import BibleVerse from "../models/BibleVerse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canonical lijsten
const BOOKS_NL = [
  "Genesis","Exodus","Leviticus","Numeri","Deuteronomium","Jozua","Richteren","Ruth",
  "1 Samuël","2 Samuël","1 Koningen","2 Koningen","1 Kronieken","2 Kronieken","Ezra","Nehemia",
  "Ester","Job","Psalm","Spreuken","Prediker","Hooglied","Jesaja","Jeremia","Klaagliederen",
  "Ezechiël","Daniël","Hosea","Joël","Amos","Obadja","Jona","Micha","Nahum","Habakuk","Sefanja",
  "Haggaï","Zacharia","Maleachi","Mattheüs","Markus","Lukas","Johannes","Handelingen",
  "Romeinen","1 Korinthe","2 Korinthe","Galaten","Efeze","Filippenzen","Kolossenzen",
  "1 Thessalonicenzen","2 Thessalonicenzen","1 Timotheüs","2 Timotheüs","Titus","Filemon",
  "Hebreeën","Jakobus","1 Petrus","2 Petrus","1 Johannes","2 Johannes","3 Johannes","Judas","Openbaring"
];

const BOOKS_EN = [
  "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
  "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
  "Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations",
  "Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah",
  "Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians",
  "Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy",
  "Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"
];

async function check() {
  try {
    await mongoose.connect("mongodb://127.0.0.1:27017/bijbelzoek");
    console.log("✅ Verbonden met MongoDB");

    for (const [version, books] of [
      ["HSV", BOOKS_NL],
      ["NKJV", BOOKS_EN],
    ]) {
      console.log(`\n🔎 Check ${version}`);
      for (const book of books) {
        const count = await BibleVerse.countDocuments({ version, book });
        if (count === 0) {
          console.log(`❌ ${book} ontbreekt`);
        } else {
          console.log(`✅ ${book}: ${count} verzen`);
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Check error:", err);
    process.exit(1);
  }
}

check();
