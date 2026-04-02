import mongoose from "mongoose";

const userPresenceSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },

  isOnline: {
    type: Boolean,
    default: false
  },

  lastSeen: {
    type: Date,
    default: null
  },

  socketId: {
    type: String,
    default: null
  },

  activeRoomId: { type: String, default: null }

}, { timestamps: true });

export default mongoose.model("UserPresence", userPresenceSchema);