import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatRooms",
    required: true
  },

  senderId: {
    type: String,
    required: true
  },

  message: String,

  messageType: {
    type: String,
    enum: ["text", "image", "video", "file"],
    default: "text"
  },

  mediaUrl: String,

  deliveredTo: [
    {
      userId: String,
      deliveredAt: Date
    }
  ],

  readBy: [
    {
      userId: String,
      readAt: Date
    }
  ],

  isDeleted: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

messageSchema.index({ roomId: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);