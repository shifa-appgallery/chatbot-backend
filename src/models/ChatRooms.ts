import mongoose from "mongoose";

const chatRoomsSchema = new mongoose.Schema({
  name: {
    type: String,
    default: null
  },

  isGroup: {
    type: Boolean,
    default: false
  },

  groupImage: {
    type: String,
    default: null
  },

  participants: [
    {
      userId: {
        type: String,
        required: true
      },
      first_Name: {
        type: String,
        required: true
      },
      last_name: {
        type: String,
        required: true
      },

      profile_picture: {
        type: String, // ✅ NEW
        default: null
      },

      unreadCount: {
        type: Number, // ✅ NEW
        default: 0
      },

      role: {
        type: String,
        enum: ["admin", "member"],
        default: "member"
      },

      joinedAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  lastMessage: {
    text: String,
    senderId: String,
    createdAt: Date
  },

  createdBy: {
    type: String
  }

}, { timestamps: true });

chatRoomsSchema.index({ "participants.userId": 1 });

export default mongoose.model("ChatRoom", chatRoomsSchema);
