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
      { upsert: true, returnDocument: "after" }
    );

    socket.broadcast.emit("user_online", { userId });
  })();

  socket.on("disconnect", async () => {
    try {
      const updated = await UserPresence.findOneAndUpdate(
        { userId },
        {
          $pull: { socketIds: socket.id },
          lastSeen: new Date()
        },
        { returnDocument: "after" }
      );

      const isOnline = (updated?.socketIds || []).length > 0;

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