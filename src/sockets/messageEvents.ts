import { Server } from "socket.io";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";
import UserPresence from "../models/UserPresence";
import UserDevice from "../models/UserDevice";
import UserPreference from "../models/UserPreference";
// import { sendPushNotification } from "../utils/sendPush";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

interface SendMessagePayload {
  roomId: string;
  message: string;
  messageType?: string;
  mediaUrl?: string | null;
}

interface MarkReadPayload {
  roomId: string;
}

interface MarkDeliveredPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {

  // --- Send message ---
  socket.on("send_message", async ({ roomId, message, messageType, mediaUrl }: SendMessagePayload) => {
    try {
      const senderId = String(socket.user?._id);

      const msg = await Messages.create({
        roomId,
        senderId,
        message,
        messageType: messageType || "text",
        mediaUrl: mediaUrl || null
      });

      const room = await ChatRooms.findById(roomId);
      if (!room) return;

      const receiverIds = room.participants
        .map(p => p.userId)
        .filter(id => id !== senderId);

      const presenceList = await UserPresence.find({
        userId: { $in: receiverIds }
      });

      const usersInOtherRoom: string[] = [];
      const offlineUsers: string[] = [];

      for (const user of presenceList) {
        if (user.isOnline && user.activeRoomId !== roomId) {
          usersInOtherRoom.push(user.userId);

          const userSockets = await io.fetchSockets();
          const socketsOfUser = userSockets.filter(
            s => String((s as any).user?._id) === user.userId
          );

          socketsOfUser.forEach(s => {
            s.emit("new_message_notification", { roomId, message, senderId });
          });

        } else if (!user.isOnline) {
          offlineUsers.push(user.userId);
        }
      }

      const usersToIncrementUnread = [
        ...usersInOtherRoom,
        ...offlineUsers
      ];

      await ChatRooms.findByIdAndUpdate(
        roomId,
        {
          lastMessage: {
            text: messageType === "text" ? message : messageType,
            senderId,
            createdAt: new Date()
          },
          $inc: {
            "participants.$[elem].unreadCount": 1
          }
        },
        {
          arrayFilters: [
            { "elem.userId": { $in: usersToIncrementUnread } }
          ]
        }
      );

      io.to(roomId.toString()).emit("receive_message", msg);
      socket.emit("message_sent", msg);

      const prefs = await UserPreference.find({
        userId: { $in: offlineUsers },
        roomId
      });

      const now = new Date();

      const allowedOfflineUsers = prefs
        .filter(p =>
          (!p.isMuted || (p.muteUntil && p.muteUntil < now)) &&
          p.notificationLevel !== "none"
        )
        .map(p => p.userId);

      const devices = await UserDevice.find({
        userId: { $in: allowedOfflineUsers },
        isActive: true
      });

      // await Promise.all(
      //   devices.map(device =>
      //     // sendPushNotification(
      //       device.fcmToken,
      //       "New Message",
      //       message,
      //       { roomId }
      //     )
      //   )
      // );

    } catch (err) {
      console.error("send_message error:", err);
    }
  });

  // --- Mark messages as delivered ---
  socket.on("mark_delivered", async ({ roomId }: MarkDeliveredPayload) => {
    const userId = String(socket.user?._id);

    // Step 1: Find messages not yet delivered to this user
    const undeliveredMessages = await Messages.find(
      { roomId, "deliveredTo.userId": { $ne: userId } },
      { _id: 1 } // only fetch _id
    );

    const messageIds = undeliveredMessages.map(m => String(m._id));

    if (messageIds.length > 0) {
      // Step 2: Update them as delivered
      await Messages.updateMany(
        { _id: { $in: messageIds } },
        {
          $addToSet: {
            deliveredTo: { userId, deliveredAt: new Date() }
          }
        }
      );

      // Step 3: Emit to other users in the room
      socket.to(roomId.toString()).emit("messages_delivered", {
        userId,
        roomId,
        messageIds
      });
    }
  });

  // --- Mark messages as read ---
  socket.on("mark_read", async ({ roomId }: MarkReadPayload) => {
    const userId = String(socket.user?._id);

    // Step 1: Find unread messages first (just their IDs for performance)
    const unreadMessages = await Messages.find(
      { roomId, "readBy.userId": { $ne: userId } },
      { _id: 1 } // only fetch _id
    );

    const messageIds = unreadMessages.map(m => String(m._id));

    if (messageIds.length > 0) {
      // Step 2: Update them as read
      await Messages.updateMany(
        { _id: { $in: messageIds } },
        {
          $addToSet: {
            readBy: { userId, readAt: new Date() }
          }
        }
      );

      // Step 3: Emit to other users in the room
      socket.to(roomId.toString()).emit("messages_read", {
        userId,
        roomId,
        messageIds
      });

      // Step 4: Reset unread count for this user in the room
      await ChatRooms.findOneAndUpdate(
        { _id: roomId, "participants.userId": userId },
        { $set: { "participants.$.unreadCount": 0 } }
      );
    }
  });

};