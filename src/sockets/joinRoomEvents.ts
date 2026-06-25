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
            "participants.$.unreadCount": 0,
          },
        }
      );

      const unreadMessages = await Messages.find(
        {
          roomId,
          senderId: { $ne: userId },
          "readBy.userId": { $ne: userId },
        },
        { _id: 1 }
      );

      const messageIds = unreadMessages.map((m) =>
        String(m._id)
      );

      if (messageIds.length > 0) {
        const readAt = new Date();

        await Messages.updateMany(
          { _id: { $in: messageIds } },
          {
            $addToSet: {
              readBy: {
                userId,
                readAt,
              },
            },
          }
        );

        const room = await ChatRooms.findById(roomId)
          .select("participants")
          .lean();

        const currentUser = room?.participants?.find(
          (p: any) =>
            String(p.userId) === String(userId)
        );

        const userProfile = currentUser?.profile_picture
          ? currentUser.profile_picture.startsWith("http")
            ? currentUser.profile_picture
            : `${process.env.PROFILE_URL}${currentUser.profile_picture}`
          : null;

        socket.to(roomId).emit("messages_read", {
          userId,
          roomId,
          messageIds,
          readBy: [
            {
              userId,
              readAt,
              userName: currentUser
                ? `${currentUser.first_Name} ${currentUser.last_name || ""
                  }`.trim()
                : "",
              userProfile,
            },
          ],
        });
      }

      console.log(
        `User ${userId} joined room ${roomId}`
      );
    } catch (err) {
      console.error("join_room error:", err);
    }
  });

  socket.on("leave_room", async ({ roomId }: JoinRoomPayload) => {
    try {
      const userId = String(socket.user?._id);

      socket.leave(roomId);

      await UserPresence.updateOne(
        { userId, activeRoomId: roomId },
        { activeRoomId: null }
      );

      console.log(`🚪 User ${userId} left room ${roomId}`);

    } catch (err) {
      console.error("leave_room error:", err);
    }
  });

};