import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    isGroupChat: { type: Boolean, default: false },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }], // participants
    roomId: { type: String, unique: true, required: true },
    name: { type: String }, // for group chat name
  },
  { timestamps: true }
);

export default mongoose.model("Chat", chatSchema);