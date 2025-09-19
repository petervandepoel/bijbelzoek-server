// server/routes/statsRoutes.js
import express from "express";
import BibleVerse from "../models/BibleVerse.js";
import { wordRegex } from "../utils/diacritics.js";

const router = express.Router();

// 📊 Wordcounts per boek
router.get("/wordcounts", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const mode = (req.query.mode || "exact").toLowerCase();
  const words = (req.query.words || "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return res.json({ data: [] });

  try {
    const perWordAggs = await Promise.all(
      words.map(async (w) => {
        const re = wordRegex(w, mode); // ← accent-ongevoelig
        const pipeline = [
          { $match: { version } },
          {
            $project: {
              book: 1,
              cnt: {
                $size: {
                  $ifNull: [
                    {
                      $regexFindAll: {
                        input: "$text",            // niet meer $toLower; we doen i-flag
                        regex: re,                 // string pattern
                        options: "i",              // case-insensitive
                      },
                    },
                    [],
                  ],
                },
              },
            },
          },
          { $group: { _id: "$book", total: { $sum: "$cnt" } } },
          { $project: { _id: 0, book: "$_id", total: 1 } },
        ];
        const rows = await BibleVerse.aggregate(pipeline);
        return rows.map((r) => ({
          book: r.book,
          word: w,
          total: r.total,
        }));
      })
    );

    const byBook = new Map();
    for (const list of perWordAggs) {
      for (const row of list) {
        if (!byBook.has(row.book)) byBook.set(row.book, {});
        byBook.get(row.book)[row.word] = row.total;
      }
    }

    const data = Array.from(byBook.entries()).map(([book, dict]) => {
      const out = { book };
      words.forEach((w) => {
        out[w] = Number(dict[w] || 0);
      });
      return out;
    });

    res.json({ data });
  } catch (err) {
    console.error("wordcounts error:", err);
    res.status(500).json({ error: "wordcounts mislukt" });
  }
});

// 📊 Hits per boek
router.get("/hitsByBook", async (req, res) => {
  const version = (req.query.version || "HSV").trim();
  const mode = (req.query.mode || "exact").toLowerCase();
  const words = (req.query.words || "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return res.json({ data: [] });

  try {
    const regexes = words.map((w) => wordRegex(w, mode)); // ← accent-ongevoelig

    const pipeline = [
      { $match: { version } },
      {
        $project: {
          book: 1,
          counts: words.map((_, idx) => ({
            count: {
              $size: {
                $ifNull: [
                  {
                    $regexFindAll: {
                      input: "$text",
                      regex: regexes[idx],
                      options: "i",
                    },
                  },
                  [],
                ],
              },
            },
          })),
        },
      },
      { $unwind: "$counts" },
      { $group: { _id: { book: "$book" }, hits: { $sum: "$counts.count" } } },
      { $project: { _id: 0, book: "$_id.book", hits: 1 } },
    ];

    const result = await BibleVerse.aggregate(pipeline);
    res.json({ data: result });
  } catch (err) {
    console.error("hitsByBook error:", err);
    res.status(500).json({ error: "hitsByBook mislukt" });
  }
});

export default router;
