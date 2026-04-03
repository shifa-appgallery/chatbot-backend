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
        { upsert: true, returnDocument: "after" }
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
      // Pull the socketId first
      const updated = await UserPresence.findOneAndUpdate(
        { userId },
        { $pull: { socketIds: socket.id }, lastSeen: new Date() },
        { returnDocument: "after" }
      );

      if (!updated) return;

      const isOnline = updated.socketIds.length > 0;

      // Update isOnline properly
      await UserPresence.updateOne(
        { userId },
        { isOnline, ...(isOnline ? {} : { activeRoomId: null }) }
      );

      if (!isOnline) {
        io.emit("user_offline", { userId });
      }
      console.log("Disconnecting socket:", socket.id, "Remaining sockets:", updated.socketIds, "isOnline:", isOnline);
    } catch (err) {
      console.error("disconnect error:", err);
    }
  });

};