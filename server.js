// server/server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// ——— Locatie .env (naast dit bestand). Pas dit aan als jouw .env elders staat.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
// Staat .env één map hoger? Gebruik dan bijvoorbeeld:
// dotenv.config({ path: join(__dirname, "../.env") });

// ——— Bestaande routes (uit jouw project)
import searchRoutes from "./routes/searchRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import chapterRoutes from "./routes/chapterRoutes.js";
//import { router as ai } from "./routes/ai.js"; // OpenRouter-gestuurde AI endpoints
import ai from "./routes/ai.js";

import exportRoutes from "./routes/export.js";

// ——— Nieuwe routes voor bezoekersaantallen (analytics) en publieke feedback
import analyticsRouter from "./routes/analytics.js";
import feedbackRouter from "./routes/feedback.js";

const app = express();

// ——— Security, CORS, parsers & logging
app.disable("x-powered-by");
app.use(helmet());

// Meerdere origins toestaan via ALLOWED_ORIGIN="http://localhost:5173,https://jouwdomein.nl"
const allowed = (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowed,
    credentials: false,
  })
);

// JSON body (ruimer ivm AI/exports)
app.use(express.json({ limit: "2mb" }));

// Logging (mooier in dev)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Indien achter proxy (Vercel/Render/NGINX), uncomment indien nodig:
// app.set("trust proxy", 1);

// ——— MongoDB connectie
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bijbelzoek";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB verbonden"))
  .catch((err) => {
    console.error("❌ MongoDB fout:", err.message);
    process.exit(1);
  });

// ——— Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ——— Jouw bestaande API-routes
app.use("/api/search", searchRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/chapter", chapterRoutes);
app.use("/api/export", exportRoutes);
console.log("[server] /api/export mounted");
app.use("/api/ai", ai);

// ——— NIEUW: Analytics (bezoekers-tracking) & Feedback
// POST /api/analytics/track  | GET /api/analytics/stats
app.use("/api/analytics", analyticsRouter);

// GET /api/feedback          | POST /api/feedback
app.use("/api/feedback", feedbackRouter);

// Tijdelijke toevoeging voor crash logging etc.
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// log missers – tijdelijk handig
app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    console.log("[MISS]", req.method, req.originalUrl);
  }
  next();
});


// ——— 404 & error handlers
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

// ——— Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server draait op http://localhost:${PORT}`);
});

export default app;
