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
  // --- ON CONNECT ---
  (async () => {
    try {
      await UserPresence.updateOne(
        { userId },
        {
          socketIds: [socket.id],
          isOnline: true,
          lastSeen: new Date()
        },
        { upsert: true }
      );

      console.log("User connected:", userId, socket.id);

      // ✅ Notify others that user came online
      socket.broadcast.emit("user_online", { userId });

      // ✅ SEND FULL LIST (but optimized)
      const onlineUsers = await UserPresence.find(
        { isOnline: true },
        { userId: 1, _id: 0 } // 👈 only fetch required field
      );

      io.emit("online_users_list", {
        users: onlineUsers.map(u => String(u.userId))
      });

    } catch (err) {
      console.error("presence connect error:", err);
    }
  })();

  // --- ON DISCONNECT ---
  socket.on("disconnect", async () => {
    try {
      console.log("User disconnected:", userId, "Socket:", socket.id);

      // ✅ Directly mark offline (no need to check sockets)
      await UserPresence.updateOne(
        { userId },
        {
          socketIds: [],
          isOnline: false,
          lastSeen: new Date(),
          activeRoomId: null
        }
      );

      socket.broadcast.emit("user_offline", { userId });

      const onlineUsers = await UserPresence.find(
        { isOnline: true },
        { userId: 1, _id: 0 }
      );

      io.emit("online_users_list", {
        users: onlineUsers.map(u => String(u.userId))
      });

      console.log("User offline:", userId);

    } catch (err) {
      console.error("disconnect error:", err);
    }
  });

};