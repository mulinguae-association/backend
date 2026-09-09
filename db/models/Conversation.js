import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  domain: {
    type: String,
    default: "general",
    enum: [
      "general",
      "teachers",
      "courses",
      "blogs",
      "getting-started",
      "booking",
      "technical",
      "community",
    ],
  },
  messages: [
    {
      role: {
        type: String,
        enum: ["user", "assistant", "system"],
        required: true,
      },
      content: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Number,
        required: true,
      },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
});

conversationSchema.index({ userId: 1, updatedAt: -1 });
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
