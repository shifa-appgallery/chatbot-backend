import { Server } from "socket.io";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";
import UserPresence from "../models/UserPresence";
import UserDevice from "../models/UserDevice";
import UserPreference from "../models/UserPreference";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import { sendNotification } from "../utils/sendPush";
import mongoose from "mongoose";
import { PROFILE_URL } from "../constant/url";
import { MESSAGE_TYPES } from "../constant/enum";

interface SendMessagePayload {
  roomId: string;
  message: string;
  messageType?: string;
  mediaUrl?: string | null;
  poll?: {
    question: string;

    options: {
      optionId: string;
      text: string;
      votes: any[];
    }[];

    allowMultipleAnswers: boolean;
  }
}

interface MarkReadPayload {
  roomId: string;
}

interface MarkDeliveredPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {

  (async () => {
    const userId = String(socket.user?._id);

    const rooms = await ChatRooms.find({
      "participants.userId": userId
    }).select("participants lastMessage");

    rooms.forEach(room => {
      const userParticipant = room.participants.find(
        (p: any) => String(p.userId) === userId
      );

      socket.emit("room_updated", {
        roomId: room._id,
        unreadCount: userParticipant?.unreadCount || 0,
        lastMessage: room.lastMessage?.text || "",
        lastMessageDate: room.lastMessage?.createdAt || null
      });
    });
  })();

  socket.on("send_message", async ({ roomId, message, messageType, mediaUrl, poll }: SendMessagePayload) => {
    try {
      const senderId = String(socket.user?._id);

      const room = await ChatRooms.findById(roomId);
      if (!room) return;

      const senderParticipant = room.participants.find(
        (p: any) => String(p.userId) === senderId
      );

      console.log("senderParticipant:", senderParticipant);

      const senderName = senderParticipant
        ? `${senderParticipant.first_Name} ${senderParticipant.last_name}`
        : "Unknown";

      const senderProfile = senderParticipant?.profile_picture
        ? senderParticipant.profile_picture.startsWith("http")
          ? senderParticipant.profile_picture
          : `${PROFILE_URL}${senderParticipant.profile_picture}`
        : null;

      const msg = await Messages.create({
        roomId,
        senderId,
        message,
        messageType: messageType || "text",
        mediaUrl: mediaUrl || null,
        senderName,
        senderProfile,
        poll: messageType === MESSAGE_TYPES.POLL
          ? poll
          : null,
      });

      const formattedMsg = {
        ...msg.toObject(),
        senderName,
        senderProfile,
        displayMessage:
          messageType === MESSAGE_TYPES.Image
            ? "Photo"
            : messageType === MESSAGE_TYPES.Video
              ? "Video"
              : messageType === MESSAGE_TYPES.POLL
                ? `${poll?.question || "Poll"}`
                : message
      };

      const receiverIds = room.participants
        .map(p => p.userId)
        .filter(id => id !== senderId);

      const presenceList = await UserPresence.find({
        userId: { $in: receiverIds }
      });

      const usersInOtherRoom: string[] = [];
      const offlineUsers: string[] = [];

      const presenceMap = new Map(
        presenceList.map(p => [String(p.userId), p])
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
            text:
              messageType === MESSAGE_TYPES.Image
                ? "Photo"
                : messageType === MESSAGE_TYPES.Video
                  ? "Video"
                  : messageType === MESSAGE_TYPES.POLL
                    ? `${poll?.question || "Poll"}`
                    : message,
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

      // NEW: send to all presenceList with socketIds
      for (const userId of receiverIds) {

        const presence = presenceMap.get(userId);

        const userParticipant = updatedRoom?.participants?.find(
          (p: any) => String(p.userId) === String(userId)
        );

        const payload = {
          roomId,
          unreadCount: userParticipant?.unreadCount || 0,
          lastMessage: updatedRoom?.lastMessage?.text || "",
          lastMessageDate: updatedRoom?.lastMessage?.createdAt || null
        };


        if (presence && presence.socketIds?.length > 0) {
          presence.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("room_updated", payload);
          });
        }
      }

      io.to(roomId.toString()).emit("receive_message", formattedMsg);

      socket.emit("room_updated", {
        roomId,
        unreadCount: 0,
        lastMessage: updatedRoom?.lastMessage?.text || "",
        lastMessageDate: updatedRoom?.lastMessage?.createdAt || null
      });

      socket.emit("message_sent", formattedMsg);

      const usersToNotify = [...receiverIds];

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

        const userParticipant = updatedRoom?.participants.find(
          (p: any) => String(p.userId) === String(presence.userId)
        );

        const displayMessage = formattedMsg.displayMessage

        if (presence.activeRoomId !== roomId) {
          presence.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit("new_message_notification", {
              roomId,
              senderId,
              senderName,
              displayMessage,
              unreadCount: userParticipant?.unreadCount || 0
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
      const displayMessage = formattedMsg.displayMessage

      await Promise.all(
        devices.map(device =>
          sendNotification(
            device.fcmToken,
            `${senderName || "Unknown"} (${room.name || "Group"})`,
            displayMessage,
            roomId
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

      const updatedRoom = await ChatRooms.findById(roomId).select("participants lastMessage");

      const presenceList = await UserPresence.find({
        userId: { $in: updatedRoom?.participants.map((p: any) => String(p.userId)) }
      });

      presenceList.forEach(presence => {
        const userParticipant = updatedRoom?.participants.find(
          (p: any) => String(p.userId) === String(presence.userId)
        );

        presence.socketIds?.forEach((socketId: string) => {
          io.to(socketId).emit("room_updated", {
            roomId,
            unreadCount: userParticipant?.unreadCount || 0,
            lastMessage: updatedRoom?.lastMessage?.text || "",
            lastMessageDate: updatedRoom?.lastMessage?.createdAt || null
          });
        });
      });
    }
  });

  socket.on("edit_message", async ({ messageId, message, mediaUrl }: {
    messageId: string;
    message: string;
    mediaUrl?: string;
  }) => {
    try {

      console.log("edit_message called");

      const senderId = String(socket.user?._id);

      console.log("senderId", senderId);

      const existingMessage: any = await Messages.findById(messageId);

      if (!existingMessage) {
        return socket.emit("message_error", {
          message: "Message not found"
        });
      }

      if (String(existingMessage.senderId) !== senderId) {
        return socket.emit("message_error", {
          message: "Unauthorized"
        });
      }

      const oldMessage = existingMessage.message;

      const updatedMessage: any = await Messages.findByIdAndUpdate(
        messageId,
        {
          $set: {
            message,
            mediaUrl: mediaUrl || existingMessage.mediaUrl,
            isEdited: true
          }
        },
        { upsert: true, returnDocument: "after" }
      );

      if (!updatedMessage) return;

      const room: any = await ChatRooms.findById(updatedMessage.roomId);

      if (!room) return;

      const displayMessage =
        updatedMessage.messageType === MESSAGE_TYPES.Image
          ? "Photo"
          : updatedMessage.messageType === MESSAGE_TYPES.Video
            ? "Video"
            : updatedMessage.message;

      const lastMsg = room.lastMessage;

      const isLastMessage =
        lastMsg &&
        String(lastMsg.senderId) === String(senderId) &&
        lastMsg.text === oldMessage;

      if (isLastMessage) {
        await ChatRooms.findByIdAndUpdate(room._id, {
          lastMessage: {
            text: displayMessage,
            senderId,
            createdAt: updatedMessage.createdAt
          }
        });
      }

      const formattedMessage = {
        messageId: updatedMessage._id,
        message: updatedMessage.message,
        mediaUrl: updatedMessage.mediaUrl,
        isEdited: updatedMessage.isEdited,
        updatedAt: updatedMessage.updatedAt,
        displayMessage
      };

      // ROOM SOCKET
      io.to(room._id.toString()).emit(
        "message_edited",
        formattedMessage
      );

      console.log("formattedMessage:", formattedMessage);



      // ACK TO SENDER
      socket.emit("message_edit_success", formattedMessage);

      const updatedRoom: any = await ChatRooms.findById(room._id).select(
        "participants lastMessage"
      );
      console.log("updatedRoom:", updatedRoom);

      for (const participant of room.participants) {

        const userId = String(participant.userId);

        const presence: any = await UserPresence.findOne({
          userId
        });

        if (
          presence &&
          Array.isArray(presence.socketIds) &&
          presence.socketIds.length > 0
        ) {

          const userParticipant = updatedRoom?.participants?.find(
            (p: any) => String(p.userId) === userId
          );

          const payload = {
            roomId: room._id,
            unreadCount: userParticipant?.unreadCount || 0,
            lastMessage:
              updatedRoom?.lastMessage?.text || "",
            lastMessageDate:
              updatedRoom?.lastMessage?.createdAt || null
          };

          presence.socketIds.forEach((socketId: string) => {
            io.to(socketId).emit(
              "room_updated",
              payload
            );
          });
        }
      }

    } catch (err) {

      console.error("edit_message error:", err);

      socket.emit("message_error", {
        message: "Something went wrong"
      });
    }
  });

  socket.on("react_message", async ({ messageId, reaction, reactionUrl }: {
    messageId: string;
    reaction: string;
    reactionUrl: string;
  }) => {
    try {
      const userId = String(socket.user?._id);

      const messageDoc: any = await Messages.findById(messageId);

      if (!messageDoc) return;

      const room: any = await ChatRooms.findById(messageDoc.roomId);

      const userMap = new Map();

      room?.participants?.forEach((p: any) => {
        userMap.set(String(p.userId), {
          userName: `${p.first_Name} ${p.last_name}`,
          userProfile: p.profile_picture
            ? p.profile_picture.startsWith("http")
              ? p.profile_picture
              : `${PROFILE_URL}${p.profile_picture}`
            : null
        });
      });


      const existingReactionIndex =
        messageDoc.reactions.findIndex(
          (r: any) => String(r.userId) === userId
        );

      if (
        existingReactionIndex !== -1 &&
        messageDoc.reactions[existingReactionIndex].reaction === reaction
      ) {
        messageDoc.reactions.splice(existingReactionIndex, 1);
      }

      else if (existingReactionIndex !== -1) {
        messageDoc.reactions[existingReactionIndex] = {
          userId,
          reaction,
          reactionUrl,
          reactedAt: new Date(),

        };
      }

      else {
        messageDoc.reactions.push({
          userId,
          reaction,
          reactionUrl,
          reactedAt: new Date()
        });
      }

      await messageDoc.save();

      const formattedReactions = messageDoc.reactions.map((r: any) => {
        const reactionUser = userMap.get(String(r.userId));
        return {
          userId: r.userId,
          reaction: r.reaction,
          reactionUrl: r.reactionUrl,
          reactedAt: r.reactedAt,
          userName:
            reactionUser?.userName || "Unknown",

          userProfile:
            reactionUser?.userProfile || null
        }
      });

      io.to(messageDoc.roomId.toString()).emit(
        "message_reacted",
        {
          messageId,
          reactions: formattedReactions
        }
      );

    } catch (err) {
      console.error("react_message error:", err);
    }
  }
  );

  socket.on("vote_poll", async ({ messageId, optionId }: {
    messageId: string;
    optionId: string;
  }) => {
    try {
      const userId = String(socket.user?._id);

      const messageDoc: any = await Messages.findById(messageId);

      if (
        !messageDoc ||
        messageDoc.messageType !== "poll"
      ) {
        return;
      }

      const poll = messageDoc.poll;

      // REMOVE OLD VOTE (single answer poll)
      if (!poll.allowMultipleAnswers) {
        poll.options.forEach((option: any) => {
          option.votes = option.votes.filter(
            (v: any) => String(v.userId) !== userId
          );
        });
      }

      const selectedOption = poll.options.find(
        (o: any) => o.optionId === optionId
      );

      if (!selectedOption) return;

      const alreadyVoted = selectedOption.votes.some(
        (v: any) => String(v.userId) === userId
      );

      // TOGGLE VOTE
      if (alreadyVoted) {
        selectedOption.votes =
          selectedOption.votes.filter(
            (v: any) => String(v.userId) !== userId
          );
      } else {
        selectedOption.votes.push({
          userId,
          votedAt: new Date()
        });
      }

      await messageDoc.save();

      io.to(messageDoc.roomId.toString()).emit(
        "poll_updated",
        {
          messageId,
          poll: messageDoc.poll
        }
      );

    } catch (err) {
      console.error("vote_poll error:", err);
    }
  }
  );

};