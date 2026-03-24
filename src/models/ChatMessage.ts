import mongoose from "mongoose";
import { MESSAGE_TYPES } from "../constant/enum"; // your enum

const chatMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    roomId: {
      type: String,
      required: true,
      ref: "Chat-Rooms",
    },
    isGroupMessage: {
      type: Boolean,
      default: false,
    },
    message: { type: String },
    messageReadBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date, default: Date.now },
      },
    ],
    messageType: {
      type: String,
      enum: Object.values(MESSAGE_TYPES),
      default: MESSAGE_TYPES.Text,
    },
    mediaUrl: { type: String },
    thumbnailUrl: { type: String },
    feedId: { type: mongoose.Schema.Types.ObjectId, ref: "Feed", default: null },
    aiResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    isActive: { type: Boolean, default: true },
    isDelete: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Indexes for performance
chatMessageSchema.index({ roomId: 1 });
chatMessageSchema.index({ roomId: 1, createdAt: -1 });
chatMessageSchema.index({ roomId: 1, senderId: 1, isDelete: 1 });
chatMessageSchema.index({ "messageReadBy.userId": 1, roomId: 1, createdAt: -1 });

export default mongoose.model("ChatMessage", chatMessageSchema);