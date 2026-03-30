import mongoose from "mongoose";

const userPreferenceSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true
  },

  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "ChatRooms"
  },

  isMuted: {
    type: Boolean,
    default: false
  },

  muteUntil: {
    type: Date,
    default: null
  },

  isPinned: {
    type: Boolean,
    default: false
  },

  pinnedAt: {
    type: Date,
    default: null
  },

  isArchived: {
    type: Boolean,
    default: false
  },

  notificationLevel: {
    type: String,
    enum: ["all", "mentions", "none"],
    default: "all"
  }

}, { timestamps: true });

// One record per user per room
userPreferenceSchema.index({ userId: 1, roomId: 1 }, { unique: true });

export default mongoose.model("UserPreference", userPreferenceSchema);