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

      socket.emit("room_updated", {
        roomId: room._id,
        unreadCount: userParticipant?.unreadCount || 0,
        lastMessage: room.lastMessage?.text || "",
        lastMessageDate: room.lastMessage?.createdAt || null
      });
    });
  })();

  socket.on("send_message", async ({ roomId, message, messageType, mediaUrl, poll, replyMessageId, isForwarded = false, mentions = [] }: SendMessagePayload) => {
    try {

      const senderId = String(socket.user?._id);

      const room = await ChatRooms.findById(roomId);

      if (!room) return;


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

      console.log(
        "senderParticipant:",
        senderParticipant
      );

      const senderName =
        `${senderParticipant.first_Name} ${senderParticipant.last_name}`;

      const senderProfile =
        senderParticipant?.profile_picture
          ? senderParticipant.profile_picture.startsWith(
            "http"
          )
            ? senderParticipant.profile_picture
            : `${PROFILE_URL}${senderParticipant.profile_picture}`
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
            if (
              m.startIndex < 0 ||
              m.endIndex > message.length ||
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

            const mentionText =
              message.substring(
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

      // =========================
      // CREATE MESSAGE
      // =========================

      const msg = await Messages.create({
        roomId,
        senderId,
        message,
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
          uniqueMentions
      });

      // =========================
      // FORMATTED MESSAGE
      // =========================

      const formattedMsg = {
        ...msg.toObject(),
        senderName,
        senderProfile,

        isForwarded:
          msg.isForwarded || false,

        displayMessage:
          messageType ===
            MESSAGE_TYPES.Image
            ? "Photo"

            : messageType ===
              MESSAGE_TYPES.Video
              ? "Video"

              : messageType ===
                MESSAGE_TYPES.POLL
                ? `${poll?.question || "Poll"}`

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
              messageType ===
                MESSAGE_TYPES.Image
                ? "Photo"

                : messageType ===
                  MESSAGE_TYPES.Video
                  ? "Video"

                  : messageType ===
                    MESSAGE_TYPES.POLL
                    ? `${poll?.question || "Poll"}`

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

          unreadCount:
            userParticipant?.unreadCount || 0,

          lastMessage:
            updatedRoom?.lastMessage?.text || "",

          lastMessageDate:
            updatedRoom?.lastMessage?.createdAt ||
            null
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
        formattedMsg
      );

      socket.emit(
        "room_updated",
        {
          roomId,
          unreadCount: 0,

          lastMessage:
            updatedRoom?.lastMessage?.text || "",

          lastMessageDate:
            updatedRoom?.lastMessage?.createdAt ||
            null
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

                    : `${senderName} replied: ${message}`;
          }

          // MENTION NOTIFICATION
          const isMentioned =
            uniqueMentions.some(
              (m: any) =>
                String(m.userId) ===
                String(
                  presence.userId
                )
            );

          if (isMentioned) {

            displayMessage =
              `${senderName} mentioned you: ${message}`;
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
                messageType ===
                  MESSAGE_TYPES.Image
                  ? `${senderName} replied with a photo`

                  : messageType ===
                    MESSAGE_TYPES.Video
                    ? `${senderName} replied with a video`

                    : messageType ===
                      MESSAGE_TYPES.POLL
                      ? `${senderName} replied with a poll`

                      : `${senderName} replied: ${message}`;
            }

            // MENTION PUSH
            const isMentioned =
              uniqueMentions.some(
                (m: any) =>
                  String(m.userId) ===
                  String(device.userId)
              );

            if (isMentioned) {

              displayMessage =
                `${senderName} mentioned you: ${message}`;
            }

            const otherParticipant = room.participants.find(
              (p: any) => String(p.userId) !== String(senderId)
            );

            const chatTitle = room.isGroup
              ? room.name || "Group"
              : otherParticipant
                ? `${otherParticipant.first_Name} ${otherParticipant.last_name}`
                : "Chat";

            return sendNotification(
              device.fcmToken,

              `${senderName || "Unknown"} (${chatTitle})`,

              displayMessage,

              roomId
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

  socket.on(
    "edit_message",
    async ({
      messageId,
      message,
      mediaUrl,
      mentions = []
    }: {
      messageId: string;
      message: string;
      mediaUrl?: string;
      mentions?: {
        userId: string;
        userName: string;
        startIndex: number;
        endIndex: number;
      }[];
    }) => {

      try {

        console.log(
          "edit_message called"
        );

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
          existingMessage.message;

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
                  message.length ||

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
                  message.substring(
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

                message,

                mentions:
                  uniqueMentions,

                mediaUrl:
                  mediaUrl ??
                  existingMessage.mediaUrl,

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

          updatedMessage.messageType ===
            MESSAGE_TYPES.Image

            ? "Photo"

            : updatedMessage.messageType ===
              MESSAGE_TYPES.Video

              ? "Video"

              : updatedMessage.messageType ===
                MESSAGE_TYPES.POLL

                ? (
                  updatedMessage.poll?.question ||
                  "Poll"
                )

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

        console.log(
          "formattedMessage:",
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

              unreadCount:
                userParticipant?.unreadCount || 0,

              lastMessage:
                updatedRoom?.lastMessage?.text || "",

              lastMessageDate:
                updatedRoom?.lastMessage?.createdAt ||
                null
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
                `${existingMessage.senderName} mentioned you in an edited message: ${message}`;

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
                        : `${PROFILE_URL}${voteUser.profile_picture}`
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

      const userId = String(socket.user?._id);

      const room: any =
        await ChatRooms.findById(roomId);

      if (!room) return;

      // RECEIVER ONLY
      if (
        room.chatRequestSenderId === userId
      ) {
        return;
      }

      room.chatRequestStatus = "accepted";

      await room.save();

      io.to(roomId.toString()).emit(
        "chat_request_accepted",
        {
          roomId,
          chatRequestStatus: "accepted"
        }
      );

    } catch (err) {

      console.error(
        "accept_chat_request error:",
        err
      );
    }
  }
  );

  socket.on("reject_chat_request", async ({ roomId }) => {
    try {

      const userId = String(socket.user?._id);

      const room: any =
        await ChatRooms.findById(roomId);

      if (!room) return;

      // RECEIVER ONLY
      if (
        room.chatRequestSenderId === userId
      ) {
        return;
      }

      room.chatRequestStatus = "rejected";

      await room.save();

      io.to(roomId.toString()).emit(
        "chat_request_rejected",
        {
          roomId,
          chatRequestStatus: "rejected"
        }
      );

    } catch (err) {

      console.error(
        "reject_chat_request error:",
        err
      );
    }
  }
  );

  socket.on(
    "get_unread_count",
    async ({ roomId }: { roomId?: string }) => {
      try {

        const userId = String(socket.user?._id);

        console.log("User ID:", userId);
        console.log("Room ID:", roomId);

        const roomMatch: any = {
          "participants.userId": userId
        };

        if (roomId) {
          roomMatch._id = roomId;
        }

        console.log(
          "Room Match Query:",
          JSON.stringify(roomMatch, null, 2)
        );

        const rooms = await ChatRooms.find(roomMatch)
          .select("_id")
          .lean();


        console.log(
          "Rooms:",
          rooms
        );

        if (!rooms.length) {

          console.log(
            "No rooms found for user"
          );

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

        console.log(
          "Room IDs:",
          roomIds
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

        console.log(
          "Message Match Query:",
          JSON.stringify(matchQuery, null, 2)
        );

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

        console.log(
          "Aggregation Result:"
        );

        console.log(
          JSON.stringify(
            result,
            null,
            2
          )
        );

        if (roomId) {

          const unreadCount =
            result[0]?.unreadCount || 0;

          console.log(
            "Single Room Unread Count:",
            unreadCount
          );

          socket.emit(
            "unread_count",
            {
              roomId,
              unreadCount
            }
          );

          console.log(
            "Single room response emitted"
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

        console.log(
          "Total Unread Messages:",
          totalUnreadMessages
        );

        console.log(
          "Total Chats With Unread:",
          result.length
        );

        const response = {
          totalUnreadMessages,
          totalChatsUnread:
            result.length,
          data: result
        };

        console.log(
          "Socket Response:"
        );

        console.log(
          JSON.stringify(
            response,
            null,
            2
          )
        );

        socket.emit(
          "unread_count",
          response
        );

        console.log(
          "Unread count emitted successfully"
        );

        console.log(
          "========== END GET UNREAD COUNT ==========\n"
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