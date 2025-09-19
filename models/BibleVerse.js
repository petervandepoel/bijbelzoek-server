import mongoose from "mongoose";

const verseSchema = new mongoose.Schema({
  version: { type: String, required: true },   // HSV, NKJV
  book: { type: String, required: true },
  chapter: { type: Number, required: true },
  verse: { type: Number, required: true },
  text: { type: String, required: true },
  ref: { type: String, required: true }        // "Genesis 1:1"
});

verseSchema.index({ version: 1, book: 1, chapter: 1, verse: 1 });
verseSchema.index({ text: "text" });

export default mongoose.model("BibleVerse", verseSchema);
