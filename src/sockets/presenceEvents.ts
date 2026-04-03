import { Server } from "socket.io";
import UserPresence from "../models/UserPresence";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

export default (socket: AuthenticatedSocket, io: Server) => {
  const userId = socket.user?._id ? String(socket.user._id) : null;

  if (!userId) {
    console.warn("Socket connected without user");
    return;
  }

  // --- ON CONNECT ---
  (async () => {
    try {
      const presence = await UserPresence.findOneAndUpdate(
        { userId },
        {
          isOnline: true,
          lastSeen: new Date(),
          $addToSet: { socketIds: socket.id }
        },
        { upsert: true, new: true }
      );

      socket.broadcast.emit("user_online", { userId });

      const onlineUsers = await UserPresence.find({ isOnline: true }).select("userId");

      socket.emit("online_users_list", {
        users: onlineUsers.map(u => String(u.userId))
      });

    } catch (err) {
      console.error("presence connect error:", err);
    }
  })();

  // --- ON DISCONNECT ---
  socket.on("disconnect", async () => {
    try {
      const updated = await UserPresence.findOneAndUpdate(
        { userId },
        {
          $pull: { socketIds: socket.id },
          lastSeen: new Date()
        },
        { new: true }
      );

      if (!updated) return;

      const remainingSockets = updated.socketIds || [];
      const isOnline = remainingSockets.length > 0;

      await UserPresence.updateOne(
        { userId },
        {
          isOnline,
          ...(isOnline === false && { activeRoomId: null }) // ✅ important
        }
      );

      if (!isOnline) {
        io.emit("user_offline", { userId });
      }

    } catch (err) {
      console.error("disconnect error:", err);
    }
  });
};