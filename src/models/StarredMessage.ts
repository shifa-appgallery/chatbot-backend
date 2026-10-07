import mongoose from "mongoose";

const starredMessageSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true
  },

  messageId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Messages"
  },

  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "ChatRooms"
  },

  starredAt: {
    type: Date,
    default: Date.now
  }

}, { timestamps: true });


// One user can star a message only once
starredMessageSchema.index(
  { userId: 1, messageId: 1 },
  { unique: true }
);

export default mongoose.model(
  "StarredMessage",
  starredMessageSchema
);