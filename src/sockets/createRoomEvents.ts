import { Server } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import ChatRooms from "../models/ChatRooms";

interface CreateRoomPayload {
  userId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {
  socket.on("create_room", async ({ userId }: CreateRoomPayload) => {
    try {
      const currentUser = String(socket.user?._id);

      if (!userId) {
        return socket.emit("error", { message: "userId is required" });
      }

      let room = await ChatRooms.findOne({
        "participants.userId": { $all: [currentUser, userId] },
        "participants": { $size: 2 }
      });

      if (!room) {
        room = await ChatRooms.create({
          participants: [
            { userId: currentUser },
            { userId }
          ]
        });
      }

      const roomId = room._id.toString();

      socket.join(roomId);

      const otherSocket = [...io.sockets.sockets.values()]
        .find(s => String((s as any).user?._id) === userId);

      if (otherSocket) {
        otherSocket.join(roomId);
      }

      socket.emit("room_created", room);

    } catch (err) {
      console.error("create_room error:", err);
      socket.emit("error", { message: "Failed to create room" });
    }
  });
};