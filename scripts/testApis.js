// server/scripts/testApis.js
import fetch from "node-fetch";

const BASE = process.env.API_BASE || "http://localhost:5000";

async function test(name, url, options) {
  try {
    const res = await fetch(BASE + url, options);
    const text = await res.text();
    console.log(`\n=== ${name} (${url}) ===`);
    console.log("Status:", res.status);
    console.log(text.slice(0, 800)); // eerste stuk (max 800 chars)
  } catch (e) {
    console.error(`\n❌ ${name} error:`, e.message);
  }
}

(async () => {
  // Health
  await test("Health", "/healthz");

  // Search (OR default)
  await test("Search OR", "/api/search?version=HSV&words=genade,geloof&resultLimit=3");

  // Search exact
  await test("Search exact", "/api/search?version=HSV&words=zoek&mode=exact&resultLimit=3");

  // Search fuzzy
  await test("Search fuzzy", "/api/search?version=HSV&words=zoek&mode=fuzzy&resultLimit=3");

  // Stats hitsByBook
  await test("Stats hitsByBook", "/api/stats/hitsByBook?version=HSV&words=genade");

  // Stats wordcounts
  await test("Stats wordcounts", "/api/stats/wordcounts?version=HSV&mode=exact&words=genade,geloof");

  // Versions
  await test("Versions", "/api/versions");

  // Debug smoke
  await test("Debug smoke", "/api/debug/smoke");

  // Chapter
  await test("Chapter", "/api/chapter?version=HSV&book=Genesis&chapter=1");

  // Export (hint page)
  await test("Export", "/api/export");

  // AI simple (alleen als OPENAI_API_KEY is gezet)
  await test("AI", "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Vat Genesis 1 samen in 1 zin." })
  });

  // Analytics track
  await test("Analytics track", "/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "pageview", path: "/test", ts: Date.now() })
  });

  // Analytics stats
  await test("Analytics stats", "/api/analytics/stats");

  // Feedback add
  await test("Feedback add", "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", message: "Hallo vanaf testApis.js" })
  });

  // Feedback list
  await test("Feedback list", "/api/feedback");
})();
