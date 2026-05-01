import { Server } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

export default (socket: AuthenticatedSocket, io: Server) => {

  socket.on("delete_for_everyone", ({ roomId, messageId }) => {
    socket.to(roomId).emit("message:deleted_for_everyone", {
      messageId
    });
  });

  socket.on("delete_for_me", ({ messageId }) => {
    socket.emit("message:deleted_for_me", {
      messageId
    });
  });

  socket.on("clear_chat", ({ roomId }) => {
    socket.emit("chat:cleared", {
      roomId
    });
  });

};