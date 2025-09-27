import express from "express";
import crypto from "crypto";
import Feedback from "../models/Feedback.js";

const router = express.Router();

/**
 * POST /api/feedback
 * Sla nieuwe feedback op in MongoDB
 */
router.post("/", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: "Bericht is verplicht" });
    }

    // IP hash berekenen
    const ip =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
    const userAgent = req.headers["user-agent"] || "";

    const fb = new Feedback({
      name: name || "Anoniem",
      email, // alleen zichtbaar voor beheerder
      subject: subject || "feedback",
      message,
      ipHash,
      userAgent,
    });

    await fb.save();
    res.json({ success: true, id: fb._id });
  } catch (err) {
    console.error("Feedback save error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * GET /api/feedback?page=1
 * Haal feedback op (max 5 per pagina)
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;

    const feedbacks = await Feedback.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const count = await Feedback.countDocuments();

    res.json({
      data: feedbacks.map((f) => ({
        id: f._id,
        name: f.name,
        subject: f.subject,
        message: f.message,
        createdAt: f.createdAt,
        // ⚠️ email niet meesturen, alleen in DB zichtbaar
      })),
      total: count,
      page,
      pages: Math.ceil(count / limit),
    });
  } catch (err) {
    console.error("Feedback fetch error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
