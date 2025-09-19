import { readFileSync, writeFileSync } from "fs";

const input  = process.argv[2] || "./bible_hsv_fixed.json";
const output = process.argv[3] || input.replace(/\.json$/,"") + ".cleaned.json";

const raw = JSON.parse(readFileSync(input, "utf8"));
const map = new Map();
const dups = new Map();

for (const r of raw) {
  const rec = { ...r };
  if (!rec.book && rec.Book) { rec.book = rec.Book; delete rec.Book; }
  if (!rec.book) { console.warn("⚠️ ontbrekend 'book' veld:", rec); continue; }

  const key = `${rec.book}|${rec.chapter}|${rec.verse}`;

  if (map.has(key)) {
    // bewaar de langste tekst als heuristiek
    const prev = map.get(key);
    const keep = (rec.text||"").length >= (prev.text||"").length ? rec : prev;
    const drop = keep === rec ? prev : rec;
    map.set(key, keep);
    dups.set(key, [...(dups.get(key)||[]), drop]);
  } else {
    map.set(key, rec);
  }
}

const fixed = [...map.values()];
writeFileSync(output, JSON.stringify(fixed, null, 2));
console.log(`✅ Geschreven: ${fixed.length} records → ${output}`);
console.log(`ℹ️  Verwijderde dubbelen: ${raw.length - fixed.length}`);
if (dups.size) {
  console.log("🔎 Dubbelen gevonden op:", [...dups.keys()].slice(0,10), dups.size > 10 ? "…" : "");
}
