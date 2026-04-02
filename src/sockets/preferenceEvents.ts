import { Server, Socket } from "socket.io";
import UserPreference from "../models/UserPreference";
import mongoose from "mongoose";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

// Payload type
interface UpdatePreferencePayload {
  roomId: string;
  isMuted?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  notificationLevel?: string;
  muteUntil?: Date | null;
}

export default (socket: AuthenticatedSocket, io: Server) => {
  const userId = String(socket.user?._id);

  socket.on("update_preference", async (data: UpdatePreferencePayload) => {
    try {
      const {
        roomId,
        isMuted,
        isPinned,
        isArchived,
        notificationLevel,
        muteUntil
      } = data;

      const pref = await UserPreference.findOneAndUpdate(
        { userId, roomId: new mongoose.Types.ObjectId(roomId) },
        {
          isMuted,
          isPinned,
          isArchived,
          notificationLevel,
          ...(isPinned && { pinnedAt: new Date() }),
          ...(isMuted && { muteUntil: muteUntil || null })
        },
        { upsert: true, returnDocument: "after" }
      );

      // Emit updated preference to user
      socket.emit("preference_updated", pref);
    } catch (err) {
      console.error("update_preference error:", err);
    }
  });
};