import { Socket, Server } from "socket.io";
import messageEvents from "./messageEvents";
import typingEvents from "./typingEvents";
import presenceEvents from "./presenceEvents";
import preferenceEvents from "./preferenceEvents";
import joinRoomEvents from "./joinRoomEvents";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import createRoomEvents from "./createRoomEvents";
import deleteEvents from "./deleteEvents";

export const chatHandler = (io: Server, socket: AuthenticatedSocket) => { 
  console.log("User connected:", socket.user?._id);

  messageEvents(socket, io);
  typingEvents(socket, io);
  presenceEvents(socket, io);
  preferenceEvents(socket, io);
  joinRoomEvents(socket, io);
  createRoomEvents(socket, io);
  deleteEvents(socket, io);
};