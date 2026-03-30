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
        socketId: socket.id
      },
      { upsert: true, new: true }
    );

    socket.broadcast.emit("user_online", { userId });
  })();

  socket.on("disconnect", async () => {
    await UserPresence.findOneAndUpdate(
      { userId },
      {
        isOnline: false,
        lastSeen: new Date(),
        socketId: null
      }
    );

    socket.broadcast.emit("user_offline", { userId });
  });
};