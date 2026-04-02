import { Socket, Server } from "socket.io";
import UserPresence from "../models/UserPresence";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

export default (socket: AuthenticatedSocket, io: Server) => {
  const userId = String(socket.user?._id);

  (async () => {
    await UserPresence.findOneAndUpdate(
      { userId },
      {
        isOnline: true,
        lastSeen: new Date(),
        $addToSet: { socketIds: socket.id }
      },
      { upsert: true, new: true }
    );

    socket.broadcast.emit("user_online", { userId });
  })();

  socket.on("disconnect", async () => {
    try {
      // Step 1: remove this socket
      await UserPresence.findOneAndUpdate(
        { userId },
        {
          $pull: { socketIds: socket.id },
          lastSeen: new Date()
        }
      );

      // Step 2: check remaining sockets
      const userPresence = await UserPresence.findOne({ userId });

      const isOnline = (userPresence?.socketIds || []).length > 0;

      // Step 3: update isOnline
      await UserPresence.updateOne(
        { userId },
        { isOnline }
      );

      socket.broadcast.emit("user_offline", { userId });

    } catch (err) {
      console.error("disconnect error:", err);
    }
  });
};