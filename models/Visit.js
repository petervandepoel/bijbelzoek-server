import mongoose from "mongoose";

const VisitSchema = new mongoose.Schema(
  {
    page: { type: String, required: true },     // bv. "uitleg"
    date: { type: String, required: true },     // "YYYY-MM-DD" (UTC)
    ipHash: { type: String, default: "" },      // gehashte IP voor unique count
    userAgent: { type: String, default: "" },
    count: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Indexen voor snelle aggregatie
VisitSchema.index({ date: 1 });
VisitSchema.index({ page: 1, date: 1 });
VisitSchema.index({ date: 1, ipHash: 1 });

export default mongoose.model("Visit", VisitSchema);
