import { Server } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

export default (socket: AuthenticatedSocket, io: Server) => {

  // ✅ delete for everyone
  socket.on("delete_for_everyone", ({ roomId, messageId }) => {
    socket.to(roomId).emit("message:deleted_for_everyone", {
      messageId
    });
  });

  // ✅ delete for me (only sender gets response)
  socket.on("delete_for_me", ({ messageId }) => {
    socket.emit("message:deleted_for_me", {
      messageId
    });
  });

  // ✅ clear chat
  socket.on("clear_chat", ({ roomId }) => {
    socket.emit("chat:cleared", {
      roomId
    });
  });

};