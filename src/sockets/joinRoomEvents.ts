import { Server } from "socket.io";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import UserPresence from "../models/UserPresence";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";

interface JoinRoomPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {

  socket.on("join_room", async ({ roomId }: JoinRoomPayload) => {
    try {
      const userId = String(socket.user?._id);

      socket.join(roomId);

      await UserPresence.findOneAndUpdate(
        { userId },
        { activeRoomId: roomId },
        { upsert: true, returnDocument: "after" }
      );

      await ChatRooms.updateOne(
        { _id: roomId, "participants.userId": userId },
        {
          $set: {
            "participants.$.unreadCount": 0
          }
        },
        {
          arrayFilters: [
            { "elem.userId": { $ne: userId  } } // increase for others only
          ]
        }
      );

      await Messages.updateMany(
        {
          roomId,
          senderId: { $ne: userId },
          "readBy.userId": { $ne: userId }
        },
        {
          $addToSet: {
            readBy: {
              userId,
              readAt: new Date()
            }
          }
        }
      );

      console.log(`User ${userId} joined room ${roomId}`);

    } catch (err) {
      console.error("join_room error:", err);
    }
  });

  socket.on("leave_room", async ({ roomId }: JoinRoomPayload) => {
    try {
      const userId = String(socket.user?._id);

      socket.leave(roomId);

      await UserPresence.findOneAndUpdate(
        { userId, activeRoomId: roomId },
        { activeRoomId: null }
      );

    } catch (err) {
      console.error("leave_room error:", err);
    }
  });

};