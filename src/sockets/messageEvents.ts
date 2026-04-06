import { Server } from "socket.io";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";
import UserPresence from "../models/UserPresence";
import UserDevice from "../models/UserDevice";
import UserPreference from "../models/UserPreference";
// import { sendPushNotification } from "../utils/sendPush";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import { sendNotification } from "../utils/sendPush";
import mongoose from "mongoose";

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

      const presenceMap = new Map(
        presenceList.map(p => [p.userId, p])
      );

      // UPDATED LOOP (no fetchSockets)
      for (const userId of receiverIds) {
        const presence = presenceMap.get(userId);

        if (!presence || !presence.isOnline) {
          offlineUsers.push(userId);
        } else if (presence.activeRoomId !== roomId) {
          usersInOtherRoom.push(userId);
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

      const updatedRoom = await ChatRooms.findById(roomId).select("participants lastMessage");

      // ✅ SEND ROOM UPDATE (ONLY ADD THIS BLOCK)
      receiverIds.forEach(userId => {
        const presence = presenceMap.get(userId);

        if (presence?.socketIds?.length) {
          const userParticipant = updatedRoom?.participants.find(
            (p: any) => String(p.userId) === String(userId)
          );

          presence.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("room_updated", {
              roomId,
              unreadCount: userParticipant?.unreadCount || 0,
              lastMessage: updatedRoom?.lastMessage,
              participants: updatedRoom?.participants   // ✅ ADD THIS
            });
          });
        }
      });

      socket.emit("room_updated", {
        roomId,
        unreadCount: 0,
        lastMessage: updatedRoom?.lastMessage,
        participants: updatedRoom?.participants   // ✅ ADD THIS
      });

      io.to(roomId.toString()).emit("receive_message", msg);
      socket.emit("message_sent", msg);

      // 🔥 NEW: COMBINED USERS
      // const usersToNotify = [...usersInOtherRoom, ...offlineUsers];
      const usersToNotify = [...receiverIds];

      console.log("👥 receiverIds:", receiverIds);
      console.log("👥 offlineUsers:", offlineUsers);
      console.log("👥 usersInOtherRoom:", usersInOtherRoom);
      console.log("👥 usersToNotify:", usersToNotify);

      const prefs = await UserPreference.find({
        userId: { $in: usersToNotify.map(id => String(id)) },
        roomId: new mongoose.Types.ObjectId(roomId)
      });

      console.log("📋 prefs found:", prefs.length);

      const now = new Date();

      const allowedUsers = prefs
        .filter(p =>
          (!p.isMuted || (p.muteUntil && p.muteUntil < now)) &&
          p.notificationLevel !== "none"
        )
        .map(p => String(p.userId));

      console.log("✅ allowedUsers:", allowedUsers);

      const allowedPresence = presenceList.filter(p =>
        allowedUsers.includes(String(p.userId))
      );

      allowedPresence.forEach(presence => {
        // only users in OTHER ROOM (not same room)
        if (presence.activeRoomId !== roomId) {
          presence.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("new_message_notification", {
              roomId,
              message,
              senderId
            });
          });
        }
      });

      // PUSH NOTIFICATION (for ALL allowed users — offline + background)
      const devices = await UserDevice.find({
        userId: { $in: allowedUsers },
        isActive: true
      });

      console.log("📱 devices found:", devices.length)
      await Promise.all(
        devices.map(device =>
          sendNotification(
            device.fcmToken,
            "New Message",
            message
          )
        )
      );

    } catch (err) {
      console.error("send_message error:", err);
    }
  });

  socket.on("mark_delivered", async ({ roomId }: MarkDeliveredPayload) => {
    const userId = String(socket.user?._id);

    const undeliveredMessages = await Messages.find(
      { roomId, "deliveredTo.userId": { $ne: userId } },
      { _id: 1 }
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

  socket.on("mark_read", async ({ roomId }: MarkReadPayload) => {
    const userId = String(socket.user?._id);

    const unreadMessages = await Messages.find(
      { roomId, "readBy.userId": { $ne: userId } },
      { _id: 1 } // only fetch _id
    );

    const messageIds = unreadMessages.map(m => String(m._id));

    if (messageIds.length > 0) {
      await Messages.updateMany(
        { _id: { $in: messageIds } },
        {
          $addToSet: {
            readBy: { userId, readAt: new Date() }
          }
        }
      );

      socket.to(roomId.toString()).emit("messages_read", {
        userId,
        roomId,
        messageIds
      });

      await ChatRooms.findOneAndUpdate(
        { _id: roomId, "participants.userId": userId },
        { $set: { "participants.$.unreadCount": 0 } }
      );

      const updatedRoom = await ChatRooms.findById(roomId).select("participants");

      io.to(roomId.toString()).emit("room_updated", {
        roomId,
        participants: updatedRoom?.participants
      });
    }
  });

};