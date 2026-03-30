// joinRoomEvents.ts
import { Server, Socket } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

interface JoinRoomPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {
  socket.on("join_room", ({ roomId }: JoinRoomPayload) => {
    socket.join(roomId);
    console.log(`User ${socket.user?._id} joined room ${roomId}`);
  });

  socket.on("leave_room", ({ roomId }: JoinRoomPayload) => {
    socket.leave(roomId);
  });
};