import { Server } from "socket.io";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";
import UserPresence from "../models/UserPresence";
import UserDevice from "../models/UserDevice";
import UserPreference from "../models/UserPreference";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";
import { sendNotification } from "../utils/sendPush";
import mongoose from "mongoose";
import { MESSAGE_TYPES } from "../constant/enum";

interface SendMessagePayload {
  roomId: string;
  message: string;
  caption: string;
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
  },
  replyMessageId?: string;

  isForwarded?: boolean;

  mentions?: {
    userId: string;
    userName: string;
    startIndex: number;
    endIndex: number;
  }[];
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

      const lastSender = room.participants.find(
        (p: any) =>
          String(p.userId) === String(room.lastMessage?.senderId)
      );

      const senderProfile = lastSender?.profile_picture
        ? lastSender.profile_picture.startsWith("http")
          ? lastSender.profile_picture
          : `${process.env.PROFILE_URL}${lastSender.profile_picture}`
        : null;

      socket.emit("room_updated", {
        roomId: room._id,

        senderName: lastSender
          ? `${lastSender.first_Name} ${lastSender.last_name || ""}`.trim()
          : "",

        senderProfile,

        unreadCount: userParticipant?.unreadCount || 0,

        lastMessage: room.lastMessage?.text || "",

        lastMessageDate: room.lastMessage?.createdAt || null,
      });

    });
  })();

  socket.on("send_message", async ({ roomId, message, caption, messageType, mediaUrl, poll, replyMessageId, isForwarded = false, mentions = [] }: SendMessagePayload) => {
    try {

      const senderId = String(socket.user?._id);

      const room = await ChatRooms.findById(roomId);

      if (!room) return;

      const textContent =
        messageType === MESSAGE_TYPES.Image ||
          messageType === MESSAGE_TYPES.Video
          ? caption || ""
          : message || "";
      if (
        !room.isGroup &&
        room.chatRequestStatus !== "accepted"
      ) {

        if (
          String(room.chatRequestSenderId) === senderId
        ) {

          socket.emit("error_message", {
            message:
              "Chat request not accepted yet"
          });

          return;
        }
      }


      const senderParticipant =
        room.participants.find(
          (p: any) =>
            String(p.userId) === senderId
        );

      if (!senderParticipant) {

        socket.emit("error_message", {
          message:
            "You are not part of this room"
        });

        return;
      }

      const senderName =
        `${senderParticipant.first_Name} ${senderParticipant.last_name}`;

      const senderProfile =
        senderParticipant?.profile_picture
          ? senderParticipant.profile_picture.startsWith(
            "http"
          )
            ? senderParticipant.profile_picture
            : `${process.env.PROFILE_URL}${senderParticipant.profile_picture}`
          : null;

      // =========================
      // REPLY MESSAGE VALIDATION
      // =========================

      let replyMessageData = null;

      if (replyMessageId) {

        const parentMessage: any =
          await Messages.findById(replyMessageId);

        // SECURITY CHECK
        if (
          parentMessage &&
          String(parentMessage.roomId) ===
          String(roomId)
        ) {

          replyMessageData = {
            messageId: parentMessage._id,
            senderId: parentMessage.senderId,
            senderName: parentMessage.senderName,
            message: parentMessage.message,
            messageType: parentMessage.messageType,
            mediaUrl: parentMessage.mediaUrl
          };
        }
      }

      // =========================
      // MENTION VALIDATION
      // =========================


      const safeMentions =
        Array.isArray(mentions)
          ? mentions.filter((m: any) => {

            // VALID TYPES
            if (
              typeof m.userId !== "string" ||
              typeof m.userName !== "string" ||
              typeof m.startIndex !== "number" ||
              typeof m.endIndex !== "number"
            ) {
              return false;
            }
            // VALID INDEXES
            // VALID INDEXES
            if (
              m.startIndex < 0 ||
              m.endIndex > textContent.length ||
              m.startIndex >= m.endIndex
            ) {
              return false;
            }

            // VALID USER EXISTS IN ROOM
            const isParticipant =
              room.participants.some(
                (p: any) =>
                  String(p.userId) ===
                  String(m.userId)
              );

            if (!isParticipant) {
              return false;
            }

            // VALID TEXT MATCH

            const mentionText = textContent.substring(
              m.startIndex,
              m.endIndex
            );

            const normalizedMention =
              mentionText
                .replace("@", "")
                .replace(/\s+/g, " ")
                .trim();

            const normalizedUserName =
              m.userName
                .replace(/\s+/g, " ")
                .trim();

            if (
              normalizedMention !== normalizedUserName
            ) {

              console.warn(
                "Mention index mismatch",
                {
                  mentionText,
                  normalizedMention,
                  normalizedUserName,
                  mention: m
                }
              );
            }

            return true;
          })
          : [];

      // REMOVE DUPLICATES
      const uniqueMentions =
        safeMentions.filter(
          (
            mention: any,
            index: number,
            self: any[]
          ) =>
            index ===
            self.findIndex(
              (m: any) =>
                String(m.userId) ===
                String(mention.userId) &&
                m.startIndex ===
                mention.startIndex &&
                m.endIndex ===
                mention.endIndex
            )
        );

      const lowerText = textContent.toLowerCase();
      const isMentionAll =
        lowerText.includes("@all") ||
        lowerText.includes("@everyone");

      let finalMentions = [...uniqueMentions];

      if (isMentionAll) {
        const startIndex =
          textContent.toLowerCase().indexOf("@everyone");

        finalMentions.push({
          userId: "all",
          userName: "Everyone",
          startIndex,
          endIndex: startIndex + "@Everyone".length
        });
      }
      // =========================
      // CREATE MESSAGE
      // =========================

      const msg = await Messages.create({
        roomId,
        senderId,
        message,
        caption,
        messageType:
          messageType || "text",
        mediaUrl:
          mediaUrl || null,
        senderName,
        senderProfile,

        isForwarded,

        poll:
          messageType ===
            MESSAGE_TYPES.POLL
            ? poll
            : null,

        replyMessage:
          replyMessageData,

        mentions:
          finalMentions
      });

      // =========================
      // FORMATTED MESSAGE
      // =========================

      const formattedMsg = {
        ...msg.toObject(),
        mentions: finalMentions,
        senderName,
        senderProfile,

        isForwarded:
          msg.isForwarded || false,

        displayMessage:
          messageType === MESSAGE_TYPES.Image
            ? caption
              ? `${caption}`
              : "Photo"
            : messageType === MESSAGE_TYPES.Video
              ? caption
                ? `${caption}`
                : "Video"
              : messageType === MESSAGE_TYPES.POLL
                ? `${poll?.question || "Poll"}`

                : messageType === MESSAGE_TYPES.System
                  ? message

                  : message
      };

      // =========================
      // RECEIVERS
      // =========================

      const receiverIds =
        room.participants
          .map((p: any) =>
            String(p.userId)
          )
          .filter(
            id => id !== senderId
          );

      const presenceList =
        await UserPresence.find({
          userId: {
            $in: receiverIds
          }
        });

      const usersInOtherRoom:
        string[] = [];

      const offlineUsers:
        string[] = [];

      const presenceMap =
        new Map(
          presenceList.map(p => [
            String(p.userId),
            p
          ])
        );

      for (const userId of receiverIds) {

        const presence =
          presenceMap.get(userId);

        if (
          !presence ||
          !presence.isOnline
        ) {

          offlineUsers.push(userId);

        } else if (
          String(
            presence.activeRoomId
          ) !== String(roomId)
        ) {

          usersInOtherRoom.push(userId);
        }
      }

      const usersToIncrementUnread =
        [
          ...usersInOtherRoom,
          ...offlineUsers
        ];

      // =========================
      // UPDATE ROOM
      // =========================

      await ChatRooms.findByIdAndUpdate(
        roomId,
        {
          lastMessage: {
            text:
              messageType === MESSAGE_TYPES.Image
                ? caption
                  ? `Photo: ${caption}`
                  : "Photo"
                : messageType === MESSAGE_TYPES.Video
                  ? caption
                    ? `Video: ${caption}`
                    : "Video"
                  : messageType ===
                    MESSAGE_TYPES.POLL
                    ? `${poll?.question || "Poll"}`
                    : messageType === MESSAGE_TYPES.System
                      ? message
                      : message,

            senderId,
            createdAt:
              new Date()
          },

          $inc: {
            "participants.$[elem].unreadCount": 1
          }
        },
        {
          arrayFilters: [
            {
              "elem.userId": {
                $in:
                  usersToIncrementUnread
              }
            }
          ]
        }
      );

      const updatedRoom =
        await ChatRooms.findById(roomId)
          .select(
            "participants lastMessage"
          );

      // =========================
      // ROOM UPDATE EVENT
      // =========================

      for (const userId of receiverIds) {

        const presence =
          presenceMap.get(userId);

        const userParticipant =
          updatedRoom?.participants?.find(
            (p: any) =>
              String(p.userId) ===
              String(userId)
          );

        const payload = {

          roomId,

          senderName,
          senderProfile,
          unreadCount:
            userParticipant?.unreadCount || 0,

          lastMessage:
            updatedRoom?.lastMessage?.text || "",

          lastMessageDate:
            updatedRoom?.lastMessage?.createdAt ||
            null,
          groupName: updatedRoom?.name,
          groupImage: updatedRoom?.groupImage
        };

        if (
          presence &&
          presence.socketIds?.length > 0
        ) {

          presence.socketIds.forEach(
            (socketId: string) => {

              io.to(socketId).emit(
                "room_updated",
                payload
              );
            }
          );
        }
      }

      // =========================
      // SEND MESSAGE
      // =========================
      io.to(roomId.toString()).emit(
        "receive_message",
        formattedMsg,
      );

      socket.emit(
        "room_updated",
        {
          roomId,

          senderName,
          senderProfile,

          unreadCount: 0,

          lastMessage:
            updatedRoom?.lastMessage?.text || "",

          lastMessageDate:
            updatedRoom?.lastMessage?.createdAt ||
            null,
          groupName: updatedRoom?.name,
          groupImage: updatedRoom?.groupImage
        }
      );

      socket.emit(
        "message_sent",
        formattedMsg
      );

      // =========================
      // NOTIFICATIONS
      // =========================

      const usersToNotify =
        [...receiverIds];

      const prefs =
        await UserPreference.find({
          userId: {
            $in:
              usersToNotify.map(id =>
                String(id)
              )
          },

          roomId:
            new mongoose.Types.ObjectId(
              roomId
            )
        });

      const now = new Date();

      const allowedUsers =
        prefs
          .filter(
            p =>
              (
                !p.isMuted ||
                (
                  p.muteUntil &&
                  p.muteUntil < now
                )
              ) &&
              p.notificationLevel !== "none"
          )
          .map(p =>
            String(p.userId)
          );

      const allowedPresence =
        presenceList.filter(p =>
          allowedUsers.includes(
            String(p.userId)
          )
        );

      // SOCKET NOTIFICATIONS
      allowedPresence.forEach(
        presence => {

          const userParticipant =
            updatedRoom?.participants.find(
              (p: any) =>
                String(p.userId) ===
                String(presence.userId)
            );

          let displayMessage =
            formattedMsg.displayMessage;

          // REPLY NOTIFICATION
          if (
            replyMessageData &&
            String(
              replyMessageData.senderId
            ) ===
            String(
              presence.userId
            )
          ) {

            displayMessage =
              messageType ===
                MESSAGE_TYPES.Image
                ? `${senderName} replied with a photo`

                : messageType ===
                  MESSAGE_TYPES.Video
                  ? `${senderName} replied with a video`

                  : messageType ===
                    MESSAGE_TYPES.POLL
                    ? `${senderName} replied with a poll`

                    : `${senderName} replied: ${textContent}`;
          }

          // MENTION NOTIFICATION
          const isMentioned =
            finalMentions.some(
              (m: any) =>
                String(m.userId) === String(presence.userId)
            );

          if (isMentionAll) {
            displayMessage = `${senderName} mentioned everyone: ${textContent}`;
          }
          else if (isMentioned) {
            displayMessage = `${senderName} mentioned you: ${textContent}`;
          }

          if (
            String(
              presence.activeRoomId
            ) !== String(roomId)
          ) {

            presence.socketIds.forEach(
              (socketId: string) => {

                io.to(socketId).emit(
                  "new_message_notification",
                  {
                    roomId,
                    senderId,
                    senderName,
                    displayMessage,

                    unreadCount:
                      userParticipant?.unreadCount ||
                      0
                  }
                );
              }
            );
          }
        }
      );
      // =========================
      // PUSH NOTIFICATIONS
      // =========================

      const devices =
        await UserDevice.find({
          userId: {
            $in: allowedUsers
          },
          isActive: true
        });

      await Promise.all(

        devices.map(
          async device => {

            const userParticipant =
              updatedRoom?.participants.find(
                (p: any) =>
                  String(p.userId) === String(device.userId)
              );
            let displayMessage =
              formattedMsg.displayMessage;

            // REPLY PUSH
            if (
              replyMessageData &&
              String(
                replyMessageData.senderId
              ) ===
              String(device.userId)
            ) {

              displayMessage =
                messageType === MESSAGE_TYPES.Image
                  ? caption
                    ? `${senderName} replied: ${caption}`
                    : `${senderName} replied with a photo`
                  : messageType === MESSAGE_TYPES.Video
                    ? caption
                      ? `${senderName} replied: ${caption}`
                      : `${senderName} replied with a video`
                    : messageType === MESSAGE_TYPES.POLL
                      ? `${senderName} replied with a poll`
                      : `${senderName} replied: ${textContent}`;
            }

            // MENTION PUSH
            const isMentioned =
              finalMentions.some(
                (m: any) =>
                  String(m.userId) === String(device.userId)
              );

            if (isMentionAll) {
              displayMessage = `${senderName} mentioned everyone: ${textContent}`;
            }
            else if (isMentioned) {
              displayMessage = `${senderName} mentioned you: ${textContent}`;
            }
            const notificationTitle = room.isGroup
              ? `${senderName} (${room.name || "Group"})`
              : senderName;

            return sendNotification(
              device.fcmToken,
              notificationTitle,
              displayMessage,
              roomId,
              userParticipant?.unreadCount || 0
            );
          }
        )
      );

    } catch (err) {

      console.error(
        "send_message error:",
        err
      );
    }
  }
  );

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

      const room = await ChatRooms.findById(roomId).select(
        "participants lastMessage"
      );

      const lastSender = room?.participants?.find(
        (p: any) =>
          String(p.userId) === String(room?.lastMessage?.senderId)
      );

      const senderProfile = lastSender?.profile_picture
        ? lastSender.profile_picture.startsWith("http")
          ? lastSender.profile_picture
          : `${process.env.PROFILE_URL}${lastSender.profile_picture}`
        : null;

      socket.to(roomId.toString()).emit("messages_read", {
        userId,
        roomId,
        messageIds,
        readBy: { userId, readAt: new Date() },
        senderName: lastSender
          ? `${lastSender.first_Name} ${lastSender.last_name || ""}`.trim()
          : "",
        senderProfile
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
            lastMessageDate: updatedRoom?.lastMessage?.createdAt || null,
            groupName: updatedRoom?.name,
            groupImage: updatedRoom?.groupImage
          });
        });
      });
    }
  });

  socket.on("edit_message", async ({
    messageId,
    message,
    caption,
    mediaUrl,
    mentions = []
  }: {
    messageId: string;
    message?: string;
    caption?: string;
    mediaUrl?: string;
    mentions?: {
      userId: string;
      userName: string;
      startIndex: number;
      endIndex: number;
    }[];
  }) => {

    try {

      const senderId =
        String(socket.user?._id);

      // =========================
      // FIND EXISTING MESSAGE
      // =========================

      const existingMessage: any =
        await Messages.findById(
          messageId
        );

      if (!existingMessage) {

        return socket.emit(
          "message_error",
          {
            message:
              "Message not found"
          }
        );
      }
      const textContent =
        existingMessage.messageType === MESSAGE_TYPES.Image ||
          existingMessage.messageType === MESSAGE_TYPES.Video
          ? caption || ""
          : message || "";
      // =========================
      // ONLY SENDER CAN EDIT
      // =========================

      if (
        String(
          existingMessage.senderId
        ) !== senderId
      ) {

        return socket.emit(
          "message_error",
          {
            message:
              "Unauthorized"
          }
        );
      }

      // =========================
      // FIND ROOM
      // =========================

      const room: any =
        await ChatRooms.findById(
          existingMessage.roomId
        );

      if (!room) {

        return socket.emit(
          "message_error",
          {
            message:
              "Room not found"
          }
        );
      }

      const oldMessage =
        existingMessage.messageType === MESSAGE_TYPES.Image ||
          existingMessage.messageType === MESSAGE_TYPES.Video
          ? existingMessage.caption
            ? `Photo: ${existingMessage.caption}`
            : existingMessage.messageType === MESSAGE_TYPES.Image
              ? "Photo"
              : "Video"
          : existingMessage.message;

      // =========================
      // MENTION VALIDATION
      // =========================

      const safeMentions =
        Array.isArray(mentions)

          ? mentions
            .map((m: any) => ({

              userId:
                String(m.userId),

              // SUPPORT BOTH
              userName:
                m.userName ||
                m.username,

              startIndex:
                m.startIndex,

              endIndex:
                m.endIndex
            }))

            .filter((m: any) => {

              // VALID TYPES
              if (

                typeof m.userId !==
                "string" ||

                typeof m.userName !==
                "string" ||

                typeof m.startIndex !==
                "number" ||

                typeof m.endIndex !==
                "number"

              ) {

                return false;
              }

              // VALID INDEXES
              if (

                m.startIndex < 0 ||

                m.endIndex >
                textContent.length ||

                m.startIndex >=
                m.endIndex

              ) {

                return false;
              }

              // USER EXISTS IN ROOM
              const isParticipant =
                room.participants.some(
                  (p: any) =>
                    String(p.userId) ===
                    String(m.userId)
                );

              if (!isParticipant) {

                return false;
              }

              // VALID TEXT MATCH
              const mentionText =
                textContent.substring(
                  m.startIndex,
                  m.endIndex
                );

              const normalizedMention =
                mentionText
                  .replace("@", "")
                  .replace(/\s+/g, " ")
                  .trim();

              const normalizedUserName =
                m.userName
                  .replace(/\s+/g, " ")
                  .trim();

              if (
                normalizedMention !==
                normalizedUserName
              ) {

                console.warn(
                  "Mention index mismatch",
                  {
                    mentionText,
                    normalizedMention,
                    normalizedUserName,
                    mention: m
                  }
                );
              }

              return true;
            })

          : [];

      // =========================
      // REMOVE DUPLICATES
      // =========================

      const uniqueMentions =
        safeMentions.filter(

          (
            mention: any,
            index: number,
            self: any[]
          ) =>

            index ===
            self.findIndex(
              (m: any) =>

                String(m.userId) ===
                String(mention.userId) &&

                m.startIndex ===
                mention.startIndex &&

                m.endIndex ===
                mention.endIndex
            )
        );

      // =========================
      // UPDATE MESSAGE
      // =========================

      const updatedMessage: any =
        await Messages.findByIdAndUpdate(

          messageId,

          {
            $set: {
              message:
                message ?? existingMessage.message,

              caption:
                caption ?? existingMessage.caption,

              mentions: uniqueMentions,

              mediaUrl:
                mediaUrl ?? existingMessage.mediaUrl,

              isEdited: true
            }
          },

          {
            new: true
          }
        );

      if (!updatedMessage) {
        return;
      }

      // =========================
      // DISPLAY MESSAGE
      // =========================

      const displayMessage =
        updatedMessage.messageType === MESSAGE_TYPES.Image
          ? updatedMessage.caption
            ? `Photo: ${updatedMessage.caption}`
            : "Photo"

          : updatedMessage.messageType === MESSAGE_TYPES.Video
            ? updatedMessage.caption
              ? `Video: ${updatedMessage.caption}`
              : "Video"

            : updatedMessage.messageType === MESSAGE_TYPES.POLL
              ? updatedMessage.poll?.question || "Poll"

              : updatedMessage.message;

      // =========================
      // UPDATE LAST MESSAGE
      // =========================

      const lastMsg =
        room.lastMessage;

      const isLastMessage =

        lastMsg &&

        String(lastMsg.senderId) ===
        String(senderId) &&

        lastMsg.text ===
        oldMessage;

      if (isLastMessage) {

        await ChatRooms.findByIdAndUpdate(
          room._id,
          {
            lastMessage: {

              text:
                displayMessage,

              senderId,

              createdAt:
                updatedMessage.createdAt
            }
          }
        );
      }

      // =========================
      // FORMATTED MESSAGE
      // =========================

      const formattedMessage = {

        messageId:
          updatedMessage._id,

        roomId:
          updatedMessage.roomId,

        senderId:
          updatedMessage.senderId,

        senderName:
          updatedMessage.senderName,

        message:
          updatedMessage.message,

        caption: updatedMessage.caption,

        messageType:
          updatedMessage.messageType,

        mediaUrl:
          updatedMessage.mediaUrl,

        mentions:
          updatedMessage.mentions || [],

        isEdited:
          updatedMessage.isEdited,

        updatedAt:
          updatedMessage.updatedAt,

        createdAt:
          updatedMessage.createdAt,

        displayMessage
      };

      // =========================
      // ROOM SOCKET EVENT
      // =========================

      io.to(
        room._id.toString()
      ).emit(
        "message_edited",
        formattedMessage
      );

      // =========================
      // ACK TO SENDER
      // =========================

      socket.emit(
        "message_edit_success",
        formattedMessage
      );

      // =========================
      // UPDATED ROOM
      // =========================

      const updatedRoom: any =
        await ChatRooms.findById(
          room._id
        ).select(
          "participants lastMessage"
        );

      // =========================
      // ROOM UPDATE EVENTS
      // =========================

      const allUserIds =
        room.participants.map(
          (p: any) =>
            String(p.userId)
        );

      const presenceList =
        await UserPresence.find({
          userId: {
            $in: allUserIds
          }
        });

      const presenceMap =
        new Map(
          presenceList.map(p => [
            String(p.userId),
            p
          ])
        );

      for (
        const participant
        of room.participants
      ) {

        const userId =
          String(
            participant.userId
          );

        const presence: any =
          presenceMap.get(userId);

        if (
          presence &&
          Array.isArray(
            presence.socketIds
          ) &&
          presence.socketIds.length > 0
        ) {

          const userParticipant =
            updatedRoom?.participants?.find(
              (p: any) =>
                String(p.userId) ===
                userId
            );

          const payload = {

            roomId:
              room._id,

            senderName:
              updatedMessage.senderName,
            senderProfile: updatedMessage.senderProfile,

            unreadCount:
              userParticipant?.unreadCount || 0,

            lastMessage:
              updatedRoom?.lastMessage?.text || "",

            lastMessageDate:
              updatedRoom?.lastMessage?.createdAt ||
              null,
            groupName: updatedRoom?.name,
            groupImage: updatedRoom?.groupImage
          };
          presence.socketIds.forEach(
            (socketId: string) => {

              io.to(socketId).emit(
                "room_updated",
                payload
              );
            }
          );
        }
      }

      // =========================
      // MENTION NOTIFICATIONS
      // =========================

      if (
        uniqueMentions.length > 0
      ) {

        const mentionedUserIds =
          uniqueMentions.map(
            (m: any) =>
              String(m.userId)
          );

        const mentionPresenceList =
          await UserPresence.find({
            userId: {
              $in:
                mentionedUserIds
            }
          });

        mentionPresenceList.forEach(
          (presence: any) => {

            // DON'T SEND TO SENDER
            if (
              String(
                presence.userId
              ) === senderId
            ) {
              return;
            }

            // DON'T SEND IF USER IS ACTIVE IN SAME ROOM
            if (
              String(
                presence.activeRoomId
              ) ===
              String(room._id)
            ) {
              return;
            }

            const mentionedUser =
              updatedRoom?.participants?.find(
                (p: any) =>
                  String(p.userId) ===
                  String(
                    presence.userId
                  )
              );

            const displayMessage =
              `${existingMessage.senderName} mentioned you in an edited message: ${textContent}`;

            if (
              Array.isArray(
                presence.socketIds
              )
            ) {

              presence.socketIds.forEach(
                (
                  socketId: string
                ) => {

                  io.to(socketId).emit(
                    "new_message_notification",
                    {
                      roomId:
                        room._id,

                      senderId,

                      senderName:
                        existingMessage.senderName,

                      displayMessage,

                      unreadCount:
                        mentionedUser?.unreadCount || 0
                    }
                  );
                }
              );
            }
          }
        );
      }

    } catch (err) {

      console.error(
        "edit_message error:",
        err
      );

      socket.emit(
        "message_error",
        {
          message:
            "Something went wrong"
        }
      );
    }
  }
  );

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
              : `${process.env.ROFILE_URL}${p.profile_picture}`
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

      const messageDoc: any =
        await Messages.findById(messageId);

      if (
        !messageDoc ||
        messageDoc.messageType !== "poll"
      ) {
        return;
      }

      const poll = messageDoc.poll;

      const selectedOption = poll.options.find(
        (o: any) => o.optionId === optionId
      );

      if (!selectedOption) return;

      const alreadyVoted = selectedOption.votes.some(
        (v: any) => String(v.userId) === userId
      );

      // IF SAME OPTION CLICKED AGAIN -> DESELECT
      if (alreadyVoted) {
        selectedOption.votes =
          selectedOption.votes.filter(
            (v: any) => String(v.userId) !== userId
          );
      } else {

        // SINGLE ANSWER POLL
        if (!poll.allowMultipleAnswers) {
          poll.options.forEach((option: any) => {
            option.votes = option.votes.filter(
              (v: any) =>
                String(v.userId) !== userId
            );
          });
        }

        // ADD NEW VOTE
        selectedOption.votes.push({
          userId,
          votedAt: new Date()
        });
      }

      await messageDoc.save();

      const room: any =
        await ChatRooms.findById(
          messageDoc.roomId
        );

      const userMap = new Map();

      room?.participants?.forEach((p: any) => {
        userMap.set(String(p.userId), {
          name: `${p.first_Name} ${p.last_name}`,
          profile_picture:
            p.profile_picture || null
        });
      });

      const pollWithUsers = {
        ...messageDoc.poll.toObject(),

        options: messageDoc.poll.options.map(
          (option: any) => ({
            ...option.toObject(),

            votes: option.votes.map(
              (vote: any) => {
                const voteUser = userMap.get(
                  String(vote.userId)
                );

                return {
                  ...vote.toObject(),

                  userName:
                    voteUser?.name || "Unknown",

                  userProfile:
                    voteUser?.profile_picture
                      ? voteUser.profile_picture.startsWith(
                        "http"
                      )
                        ? voteUser.profile_picture
                        : `${process.env.PROFILE_URL}${voteUser.profile_picture}`
                      : null
                };
              }
            )
          })
        )
      };

      io.to(messageDoc.roomId.toString()).emit(
        "poll_updated",
        {
          messageId,
          poll: pollWithUsers
        }
      );

    } catch (err) {
      console.error("vote_poll error:", err);
    }
  });

  socket.on("accept_chat_request", async ({ roomId }) => {
    try {
      const userId = socket.user?._id?.toString();
      if (!userId) return;
      const room = await ChatRooms.findById(roomId);
      if (!room) return;
      if (room.chatRequestStatus !== "pending") return;

      const senderId = room.chatRequestSenderId?.toString();
      const receiver = room.participants.find(
        (p) => p.userId.toString() !== senderId
      );

      if (!receiver) return;

      // ONLY receiver allowed
      if (receiver.userId.toString() !== userId) return;

      room.chatRequestStatus = "accepted";
      await room.save();

      const devices = await UserDevice.find({
        userId: senderId,
        isActive: true,
      });

      await Promise.all(
        devices.map((device) =>
          sendNotification(
            device.fcmToken,
            "Chat Request Accepted",
            `${receiver.first_Name} ${receiver.last_name} accepted your chat request`,
            roomId
          )
        )
      );

      io.to(roomId.toString()).emit("chat_request_accepted", {
        roomId,
        chatRequestStatus: "accepted",
      });

    } catch (err) {
      console.error("accept_chat_request error:", err);
    }
  });

  socket.on("reject_chat_request", async ({ roomId }) => {
    try {
      const userId = socket.user?._id?.toString();
      if (!userId) return;

      const room = await ChatRooms.findById(roomId);
      if (!room) return;

      if (room.chatRequestStatus !== "pending") return;

      const senderId = room.chatRequestSenderId?.toString();

      // derive receiver from participants
      const receiver = room.participants.find(
        (p) => p.userId.toString() !== senderId
      );

      if (!receiver) {
        return;
      }

      // ONLY receiver can reject
      if (receiver.userId.toString() !== userId) return;

      room.chatRequestStatus = "rejected";
      await room.save();

      const devices = await UserDevice.find({
        userId: senderId,
        isActive: true,
      });

      await Promise.all(
        devices.map((device) =>
          sendNotification(
            device.fcmToken,
            "Chat Request Rejected",
            `${receiver.first_Name} ${receiver.last_name} rejected your chat request`,
            roomId
          )
        )
      );

      io.to(roomId.toString()).emit("chat_request_rejected", {
        roomId,
        chatRequestStatus: "rejected",
      });

    } catch (err) {
      console.error("reject_chat_request error:", err);
    }
  });

  socket.on(
    "get_unread_count",
    async ({ roomId }: { roomId?: string }) => {
      try {

        const userId = String(socket.user?._id);

        const roomMatch: any = {
          "participants.userId": userId
        };

        if (roomId) {
          roomMatch._id = roomId;
        }



        const rooms = await ChatRooms.find(roomMatch)
          .select("_id")
          .lean();

        if (!rooms.length) {

          socket.emit("unread_count", {
            totalUnreadMessages: 0,
            totalChatsUnread: 0,
            data: []
          });

          return;
        }

        const roomIds = rooms.map(
          (room: any) => room._id
        );

        const matchQuery = {
          roomId: {
            $in: roomIds
          },

          senderId: {
            $ne: userId
          },

          readBy: {
            $not: {
              $elemMatch: {
                userId
              }
            }
          },

          isDeleted: false
        };

        const result =
          await Messages.aggregate([
            {
              $match: matchQuery
            },
            {
              $group: {
                _id: "$roomId",
                unreadCount: {
                  $sum: 1
                }
              }
            }
          ]);

        if (roomId) {

          const unreadCount =
            result[0]?.unreadCount || 0;

          socket.emit(
            "unread_count",
            {
              roomId,
              unreadCount
            }
          );

          return;
        }

        const totalUnreadMessages =
          result.reduce(
            (
              sum: number,
              room: any
            ) =>
              sum + room.unreadCount,
            0
          );

        const response = {
          totalUnreadMessages,
          totalChatsUnread:
            result.length,
          data: result
        };

        socket.emit(
          "unread_count",
          response
        );

      } catch (err) {

        console.error(
          "========== GET UNREAD COUNT ERROR =========="
        );

        console.error(err);

        socket.emit(
          "unread_count_error",
          {
            message:
              "Failed to fetch unread count"
          }
        );
      }
    }
  );

};

export const dffg = () => {

}