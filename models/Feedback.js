import mongoose from "mongoose";

const FeedbackSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Anoniem", maxlength: 50 },
    message: { type: String, required: true, maxlength: 500 },
    ipHash: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("Feedback", FeedbackSchema);
