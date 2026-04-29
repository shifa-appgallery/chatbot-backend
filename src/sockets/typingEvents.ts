import { Server, Socket } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import { PROFILE_URL } from "../constant/url";

interface TypingPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {
  socket.on("typing_start", ({ roomId }: TypingPayload) => {
    socket.to(roomId).emit("typing", {
      userId: socket.user?._id,
      senderName: `${socket.user?.first_name} ${socket.user?.last_name}`,
      senderProfile: `${PROFILE_URL}${socket.user?.profile_picture}`,
      typing: true
    });
  });

  socket.on("typing_stop", ({ roomId }: TypingPayload) => {
    socket.to(roomId).emit("typing", {
      userId: socket.user?._id,
      senderName: `${socket.user?.first_name} ${socket.user?.last_name}`,
      senderProfile: `${PROFILE_URL}${socket.user?.profile_picture}`,
      typing: false
    });
  });
};