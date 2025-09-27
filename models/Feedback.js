import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema({
  name: { type: String, default: "Anoniem" },
  email: { type: String }, // optioneel, alleen zichtbaar voor beheerder
  subject: {
    type: String,
    enum: ["feedback", "gewoon een berichtje", "bug", "new feature", "overig"],
    default: "feedback",
  },
  message: { type: String, required: true },
  ipHash: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Feedback", feedbackSchema);
