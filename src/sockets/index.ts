import { Server } from "socket.io";
import { chatHandler } from "./chatHandler";
import { socketAuth } from "../middleware/socketAuth";

export const initSocket = (server: any) => {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.use(socketAuth);

  io.on("connection", (socket) => {
    console.log("User connected:", (socket as any).user.id);

    chatHandler(io, socket);

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });
};