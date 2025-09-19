// server/utils/diacritics.js
// Bouwt een regex die accenten negeert (e/ë/é/è/ê etc.) + veilige woordgrenzen.
const LETTERS = "A-Za-zÀ-ÖØ-öø-ÿ";

const MAP = {
  a: "aàáâãäåāăą",
  c: "cçćč",
  e: "eèéêëēĕėęě",
  i: "iìíîïīĭįı",
  o: "oòóôõöøōŏő",
  u: "uùúûüũūŭůűų",
  y: "yýÿŷ",
  n: "nñńň",
  s: "sśšş",
  z: "zźżž",
  g: "gğǵĝ",
  l: "lł",
  t: "tţť",
  d: "dďđ",
  r: "rř",
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function accentPattern(word) {
  const chars = Array.from(String(word || ""));
  return chars
    .map((ch) => {
      const k = ch.toLowerCase();
      if (MAP[k]) return `[${MAP[k]}]`;
      // letters die niet in MAP staan: laat zoals het is (case-insensitive vlag gebruiken we later)
      return escapeRe(ch);
    })
    .join("");
}

// mode: "exact" of "fuzzy"
export function wordRegex(word, mode = "exact") {
  const core = accentPattern(word);
  const W = LETTERS;
  if (mode === "fuzzy") {
    // …*[letters]*CORE*[letters]* met veilige "woordgrenzen" (niet-letter aan weerszijden)
    return `(?:^|[^${W}])[${W}]*${core}[${W}]*(?=[^${W}]|$)`;
  }
  // exacte woord-match met veilige grenzen
  return `(?:^|[^${W}])${core}(?=[^${W}]|$)`;
}
