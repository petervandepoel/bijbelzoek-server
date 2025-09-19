import express from "express";
import crypto from "crypto";
import Feedback from "../models/Feedback.js";

const router = express.Router();

// GET /api/feedback -> laatste 100 items, nieuw eerst
router.get("/", async (_req, res) => {
  const items = await Feedback.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items });
});

// POST /api/feedback -> bericht opslaan
router.post("/", async (req, res) => {
  try {
    const rawName = (req.body?.name ?? "Anoniem").toString();
    const rawMsg = (req.body?.message ?? "").toString();

    const name = rawName.trim().slice(0, 50) || "Anoniem";
    const message = rawMsg.trim();

    if (!message) return res.status(400).json({ error: "message is required" });
    if (message.length > 500) return res.status(400).json({ error: "max 500 chars" });

    // Basic spam/rate hulp: hash van IP, bewaar user-agent
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString();
    const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";
    const userAgent = (req.headers["user-agent"] || "").toString().slice(0, 255);

    const item = await Feedback.create({ name, message, ipHash, userAgent });

    res.json({
      item: {
        _id: item._id,
        name: item.name,
        message: item.message,
        createdAt: item.createdAt,
      },
    });
  } catch (e) {
    res.status(500).json({ error: "failed" });
  }
});

export default router;
