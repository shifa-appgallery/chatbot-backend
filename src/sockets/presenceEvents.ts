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
      // 1. Remove current socket
      const updated = await UserPresence.findOneAndUpdate(
        { userId },
        { $pull: { socketIds: socket.id }, lastSeen: new Date() },
        { returnDocument: "after" }
      );

      if (!updated) return;

      // 2. Check if user still has active sockets
      const isOnline = updated.socketIds && updated.socketIds.length > 0;

      // 3. Update isOnline flag
      await UserPresence.updateOne(
        { userId },
        {
          isOnline,
          ...(isOnline ? {} : { activeRoomId: null })
        }
      );

      // NEW: Always send full online users list
      const onlineUsers = await UserPresence.find({ isOnline: true }).select("userId");

      io.emit("online_users_list", {
        users: onlineUsers.map(u => String(u.userId))
      });

      console.log(
        "Disconnect:",
        socket.id,
        "Remaining:",
        updated.socketIds,
        "isOnline:",
        isOnline
      );

    } catch (err) {
      console.error("disconnect error:", err);
    }
  });

};