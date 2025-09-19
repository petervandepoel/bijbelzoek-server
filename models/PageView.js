import mongoose from "mongoose";

const PageViewSchema = new mongoose.Schema(
  {
    page: { type: String, required: true },
    count: { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Eén duidelijke index-definitie:
PageViewSchema.index({ page: 1 }, { unique: true });

export default mongoose.model("PageView", PageViewSchema);
