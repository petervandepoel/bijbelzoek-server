import express from "express";
import crypto from "crypto";
import PageView from "../models/PageView.js";
import Visit from "../models/Visit.js";

const router = express.Router();

const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

// POST /api/analytics/track  body: { page: "uitleg" }
router.post("/track", async (req, res) => {
  try {
    const page = String(req.body?.page || "unknown").slice(0, 64);

    // PageView (totaalteller per pagina)
    await PageView.findOneAndUpdate(
      { page },
      { $inc: { count: 1 }, $set: { lastViewedAt: new Date() } },
      { upsert: true }
    );

    // Visit (voor daily + unique)
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString();
    const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 255);
    const date = todayStr();

    await Visit.findOneAndUpdate(
      { page, date, ipHash },
      { $inc: { count: 1 }, $setOnInsert: { userAgent: ua } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "track_failed" });
  }
});

// GET /api/analytics/stats?limit=20  (top pagina's totaal)
router.get("/stats", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const items = await PageView.find().sort({ count: -1 }).limit(limit).lean();
  res.json({ items });
});

// GET /api/analytics/summary?days=30
router.get("/summary", async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || "30", 10), 1), 180);

  // vanaf-datum (UTC)
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  const from = d.toISOString().slice(0, 10);

  // pageviews per dag
  const pageviewsDaily = await Visit.aggregate([
    { $match: { date: { $gte: from } } },
    { $group: { _id: "$date", views: { $sum: "$count" } } },
    { $project: { _id: 0, date: "$_id", views: 1 } },
    { $sort: { date: 1 } },
  ]);

  // unieke bezoekers per dag (distinct ipHash)
  const uniquesStage1 = await Visit.aggregate([
    { $match: { date: { $gte: from } } },
    { $group: { _id: { date: "$date", ipHash: "$ipHash" } } }, // 1 per ipHash per dag
    { $group: { _id: "$_id.date", unique: { $sum: 1 } } },
    { $project: { _id: 0, date: "$_id", unique: 1 } },
    { $sort: { date: 1 } },
  ]);

  // top pagina's in periode
  const topPages = await Visit.aggregate([
    { $match: { date: { $gte: from } } },
    { $group: { _id: "$page", views: { $sum: "$count" } } },
    { $project: { _id: 0, page: "$_id", views: 1 } },
    { $sort: { views: -1 } },
    { $limit: 10 },
  ]);

  // optioneel: vul ontbrekende dagen met 0
  const fillSeries = (series, key) => {
    const map = new Map(series.map((r) => [r.date, r]));
    const out = [];
    const cursor = new Date(from + "T00:00:00Z");
    for (let i = 0; i < days; i++) {
      const ds = cursor.toISOString().slice(0, 10);
      out.push({ date: ds, [key]: map.get(ds)?.[key] || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  };

  res.json({
    pageviewsDaily: fillSeries(pageviewsDaily, "views"),
    uniqueDaily: fillSeries(uniquesStage1, "unique"),
    topPages,
  });
});

export default router;
