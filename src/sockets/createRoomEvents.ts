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

      // ✅ 1. Check existing room (1-to-1)
      let room = await ChatRooms.findOne({
        "participants.userId": { $all: [currentUser, userId] },
        "participants": { $size: 2 }
      });

      // ✅ 2. Create if not exists
      if (!room) {
        room = await ChatRooms.create({
          participants: [
            { userId: currentUser },
            { userId }
          ]
        });
      }

      const roomId = room._id.toString();

      // ✅ 3. Join current user
      socket.join(roomId);

      // ✅ 4. Join other user if online
      const otherSocket = [...io.sockets.sockets.values()]
        .find(s => String((s as any).user?._id) === userId);

      if (otherSocket) {
        otherSocket.join(roomId);
      }

      // ✅ 5. Emit result
      socket.emit("room_created", room);

      console.log(`Room ready: ${roomId}`);

    } catch (err) {
      console.error("create_room error:", err);
      socket.emit("error", { message: "Failed to create room" });
    }
  });
};