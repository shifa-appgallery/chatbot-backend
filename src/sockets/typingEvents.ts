import { Server, Socket } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

interface TypingPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {
  socket.on("typing_start", ({ roomId }: TypingPayload) => {
    socket.to(roomId).emit("typing", {
      userId: socket.user?._id,
      typing: true
    });
  });

  socket.on("typing_stop", ({ roomId }: TypingPayload) => {
    socket.to(roomId).emit("typing", {
      userId: socket.user?._id,
      typing: false
    });
  });
};