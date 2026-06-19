// src/controllers/chatController.ts
import { Request, Response } from "express";
import ChatRoom from "../models/ChatRooms";
import Message from "../models/Messages";
import UserPreference from "../models/UserPreference";
import { AuthRequest } from "../middleware/authorize";
import { Op, Sequelize } from "sequelize";
import { User } from "../models/mysql/User";
import UserDevice from "../models/UserDevice";
import { TeamUsers } from "../models/mysql/TeamUsers";
import { getSequelize } from "../config/mysql";
import mongoose from "mongoose";
import { MESSAGE_TYPES } from "../constant/enum";
import Messages from "../models/Messages";
import { sendNotification } from "../utils/sendPush";

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { name, participantIds = [], isGroup, groupImage } = req.body;

    const currentUser = req.user!;
    const currentUserId = String(currentUser.id);

    if (!participantIds.length) {
      return res.status(400).json({
        message: "participantIds are required"
      });
    }

    if (participantIds.map(String).includes(currentUserId)) {
      return res.status(400).json({
        message: "You cannot add yourself"
      });
    }

    const formattedParticipantIds = participantIds.map((id: any) =>
      String(id)
    );

    const users: any = await User.findAll({
      where: {
        id: {
          [Op.in]: formattedParticipantIds
        }
      },
      attributes: ["id", "first_name", "last_name", "profile_picture"]
    });

    if (users.length !== formattedParticipantIds.length) {
      return res.status(400).json({
        message: "Some participantIds are invalid"
      });
    }

    const userMap: Record<string, any> = {};

    users.forEach((user: any) => {
      userMap[String(user.id)] = user;
    });

    const uniqueParticipants = [
      ...new Set([currentUserId, ...formattedParticipantIds])
    ];

    if (!isGroup && uniqueParticipants.length !== 2) {
      return res.status(400).json({
        message: "1-1 chat must have exactly 2 users"
      });
    }

    // CHECK EXISTING ROOM
    const existingRoom: any = await ChatRoom.findOne({
      isGroup: !!isGroup,
      participants: {
        $size: uniqueParticipants.length,
        $all: uniqueParticipants.map((id: string) => ({
          $elemMatch: { userId: id }
        }))
      }
    });

    if (existingRoom) {
      const currentUserParticipant = existingRoom.participants.find(
        (p: any) => p.userId === currentUserId
      );

      const otherParticipants = existingRoom.participants.filter(
        (p: any) => p.userId !== currentUserId
      );

      const otherUser = otherParticipants[0];

      const groupMembers = existingRoom.participants.map((p: any) => ({
        userId: p.userId,
        fullName: `${p.first_Name} ${p.last_name}`,
        profile_picture: p.profile_picture ? p.profile_picture.startsWith("http")
          ? p.profile_picture
          : `${process.env.PROFILE_URL}${p.profile_picture}`
          : null,
        isOnline: false,
        unreadCount: p.unreadCount || 0,
        role: p.role,
        isAdmin: p.role === "admin"
      }));

      const adminIds = existingRoom.participants
        .filter((p: any) => p.role === "admin")
        .map((p: any) => p.userId);

      return res.status(200).json({
        status: true,
        data: {
          _id: existingRoom._id,
          isGroup: existingRoom.isGroup,

          name: existingRoom.isGroup
            ? existingRoom.name
            : `${otherUser.first_Name} ${otherUser.last_name}`,

          image: existingRoom.isGroup
            ? existingRoom.groupImage || ""
            : otherUser.profile_picture || "",

          lastMessage: "",
          lastMessagedate: null,

          isOnline: false,
          unreadCount: currentUserParticipant?.unreadCount || 0,

          adminIds,

          groupMembers
        }
      });
    }

    if (isGroup && !name) {
      return res.status(400).json({
        message: "Group name is required"
      });
    }

    const participants = uniqueParticipants.map((id: string) => {
      let first_Name = "";
      let last_name = "";
      let profile_picture = "";

      if (id === currentUserId) {
        first_Name = currentUser.first_name;
        last_name = currentUser.last_name;

        profile_picture = currentUser.profile_picture
          ? process.env.PROFILE_URL + currentUser.profile_picture
          : "";
      } else {
        const user = userMap[id];

        first_Name = user?.first_name || "";
        last_name = user?.last_name || "";

        profile_picture = user?.profile_picture
          ? process.env.PROFILE_URL + user.profile_picture
          : "";
      }

      return {
        userId: id,
        first_Name,
        last_name,
        profile_picture,
        role: id === currentUserId ? "admin" : "member",
        joinedAt: new Date()
      };
    });

    const room: any = await ChatRoom.create({
      name: isGroup ? name : "",
      isGroup: !!isGroup,
      groupImage: isGroup && groupImage ? groupImage : "",
      participants,
      createdBy: currentUserId,

      chatRequestStatus: isGroup
        ? "accepted"
        : "pending",

      chatRequestSenderId: isGroup
        ? null
        : currentUserId
    });

    // CREATE USER PREFERENCES
    await Promise.all(
      uniqueParticipants.map((userId: string) =>
        UserPreference.updateOne(
          {
            userId: String(userId),
            roomId: room._id
          },
          {
            $setOnInsert: {
              userId: String(userId),
              roomId: room._id,
              notificationLevel: "all",
              isMuted: false,
              isPinned: false,
              isArchived: false
            }
          },
          { upsert: true }
        )
      )
    );

    const currentUserParticipant = room.participants.find(
      (p: any) => p.userId === currentUserId
    );

    const otherParticipants = room.participants.filter(
      (p: any) => p.userId !== currentUserId
    );

    const otherUser = otherParticipants[0];

    const groupMembers = room.participants.map((p: any) => ({
      userId: p.userId,
      fullName: `${p.first_Name} ${p.last_name}`,
      profile_picture: p.profile_picture || null,
      isOnline: false,
      unreadCount: p.unreadCount || 0,
      role: p.role,
      isAdmin: p.role === "admin"
    }));

    const adminIds = room.participants
      .filter((p: any) => p.role === "admin")
      .map((p: any) => p.userId);

    if (!isGroup) {
      const receiverId = formattedParticipantIds[0];

      const devices = await UserDevice.find({
        userId: receiverId,
        isActive: true
      });

      const senderName =
        `${currentUser.first_name} ${currentUser.last_name}`;

      await Promise.all(
        devices.map((device) =>
          sendNotification(
            device.fcmToken,
            "New Chat Request",
            `${senderName} sent you a chat request`,
            room._id.toString()
          )
        )
      );
    }

    return res.status(201).json({
      status: true,
      data: {
        _id: room._id,
        isGroup: room.isGroup,

        name: room.isGroup
          ? room.name
          : `${otherUser.first_Name} ${otherUser.last_name}`,

        image: room.isGroup
          ? room.groupImage || ""
          : otherUser.profile_picture || "",

        lastMessage: "",
        lastMessagedate: null,

        isOnline: false,
        unreadCount: currentUserParticipant?.unreadCount || 0,

        adminIds,

        groupMembers
      }
    });
  } catch (err) {
    console.error("createRoom error:", err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const sendMessage = async (
  req: AuthRequest,
  res: Response
) => {
  try {

    const {
      roomId,
      message,
      caption,
      messageType,
      mediaUrl,
      replyMessageId
    } = req.body;

    const senderId = String(req.user!.id);

    const user = req.user;

    const room = await ChatRoom.findOne({
      _id: roomId,
      "participants.userId": senderId
    });

    if (!room) {
      return res.status(403).json({
        message: "You are not part of this room"
      });
    }

    if (
      !room.isGroup &&
      room.chatRequestStatus !== "accepted"
    ) {

      if (
        room.chatRequestSenderId === senderId
      ) {
        return res.status(403).json({
          message:
            "Chat request not accepted yet"
        });
      }
    }

    let replyMessageData = null;

    if (replyMessageId) {

      const parentMessage: any =
        await Message.findById(replyMessageId);

      if (parentMessage) {

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

    const deliveredTo = room.participants
      .filter(
        (p: any) => p.userId !== senderId
      )
      .map((p: any) => ({
        userId: p.userId,
        deliveredAt: new Date()
      }));

    const msg = await Message.create({
      roomId,
      senderId,
      message,
      caption,
      messageType,
      mediaUrl,

      deliveredTo,

      senderName:
        `${user?.first_name} ${user?.last_name}`,

      senderProfile: user?.profile_picture
        ? user.profile_picture.startsWith(
          "http"
        )
          ? user.profile_picture
          : `${process.env.PROFILE_URL}${user.profile_picture}`
        : null,

      // NEW FIELD
      replyMessage: replyMessageData
    });

    const type =
      (messageType || "").toLowerCase();

    const lastMessageText =
      type === MESSAGE_TYPES.Image
        ? "Photo"
        : type === MESSAGE_TYPES.Video
          ? "Video"
          : type === MESSAGE_TYPES.POLL
            ? "Poll"
            : messageType === MESSAGE_TYPES.System
              ? message
              : message;

    await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        lastMessage: {
          text: lastMessageText,
          senderId,
          createdAt: new Date()
        }
      }
    );

    return res.status(201).json({
      status: true,
      data: msg
    });

  } catch (err) {

    console.error(
      "sendMessage error:",
      err
    );

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const getRoomMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, lastDate, days = '2' } = req.query;
    const userId = String(req.user!.id);

    const limitDays = parseInt(days as string, 10) || 2;

    const roomObjectId = new mongoose.Types.ObjectId(roomId as string);

    const room: any = await ChatRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const participant = room.participants.find(
      (p: any) => String(p.userId) === userId
    );

    if (!participant) {
      return res.status(403).json({ message: "Not a participant" });
    }

    const joinedAt = participant.joinedAt || new Date(0);

    const userMap = new Map();
    room.participants.forEach((p: any) => {
      userMap.set(String(p.userId), {
        fullName: `${p.first_Name} ${p.last_name}`,
        profile_picture: p.profile_picture || null
      });
    });

    // 🔹 Anchor date
    const anchorDate =
      lastDate && lastDate !== 'null'
        ? new Date(lastDate as string)
        : new Date();

    const distinctDates = await Message.aggregate([
      {
        $match: {
          roomId: roomObjectId,
          deletedFor: {
            $not: { $elemMatch: { userId } }
          },
          createdAt: {
            $lt: anchorDate,
            $gte: joinedAt
          }
        }
      },
      {
        $project: {
          date: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          }
        }
      },
      {
        $group: {
          _id: "$date"
        }
      },
      {
        $sort: { _id: -1 }
      },
      {
        $limit: limitDays
      }
    ]);

    if (!distinctDates.length) {
      return res.json({
        status: true,
        data: [],
        nextCursor: null
      });
    }

    const dateFilters = distinctDates.map((d: any) => {
      const start = new Date(d._id);
      const end = new Date(d._id);
      end.setDate(end.getDate() + 1);

      return {
        createdAt: {
          $gte: start,
          $lt: end
        }
      };
    });

    const messages = await Message.find({
      roomId,
      deletedFor: {
        $not: {
          $elemMatch: { userId }
        }
      },
      createdAt: { $gte: joinedAt },
      $or: dateFilters
    }).sort({ createdAt: -1 }); // latest first

    // 🔹 Format messages
    const formattedMessages = messages.map((msg: any) => {
      const sender = userMap.get(String(msg.senderId));

      const reactionsWithUsers = (msg.reactions || []).map((reaction: any) => {
        const reactionUser = userMap.get(String(reaction.userId));

        return {
          ...reaction.toObject?.() || reaction,
          userName: reactionUser?.fullName || "Unknown",
          userProfile: reactionUser?.profile_picture
            ? reactionUser.profile_picture.startsWith("http")
              ? reactionUser.profile_picture
              : `${process.env.PROFILE_URL}${reactionUser.profile_picture}`
            : null
        };
      });

      const pollWithUsers = msg.poll
        ? {
          ...msg.poll.toObject?.() || msg.poll,
          options: (msg.poll.options || []).map((option: any) => ({
            ...(option.toObject?.() || option),

            votes: (option.votes || []).map((vote: any) => {
              const voteUser = userMap.get(String(vote.userId));

              return {
                ...(vote.toObject?.() || vote),

                userName: voteUser?.fullName || "Unknown",

                userProfile: voteUser?.profile_picture
                  ? voteUser.profile_picture.startsWith("http")
                    ? voteUser.profile_picture
                    : `${process.env.PROFILE_URL}${voteUser.profile_picture}`
                  : null
              };
            })
          }))
        }
        : null;

      return {
        ...msg.toObject(),
        senderName:
          msg.senderName ||
          sender?.fullName ||
          "Unknown",
        senderProfile: (() => {
          if (msg.senderProfile) {
            return msg.senderProfile.startsWith("http")
              ? msg.senderProfile
              : `${process.env.PROFILE_URL}${msg.senderProfile}`;
          }

          if (sender?.profile_picture) {
            return sender.profile_picture.startsWith("http")
              ? sender.profile_picture
              : `${process.env.PROFILE_URL}${sender.profile_picture}`;
          }

          return null;
        })(),
        reactions: reactionsWithUsers,

        poll: pollWithUsers
      };
    });

    const nextCursor =
      messages.length > 0
        ? messages[messages.length - 1].createdAt
        : null;

    return res.json({
      status: true,
      data: formattedMessages.reverse(),
      nextCursor
    });

  } catch (err) {
    console.error("getRoomMessages error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const updatePreference = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const { roomId, isMuted, isPinned, isArchived, notificationLevel, muteUntil } = req.body;

    const pref = await UserPreference.findOneAndUpdate(
      { userId, roomId },
      {
        isMuted,
        isPinned,
        isArchived,
        notificationLevel,
        ...(isPinned && { pinnedAt: new Date() }),
        ...(isMuted && { muteUntil: muteUntil || null })
      },
      { upsert: true, returnDocument: "after" }
    );

    return res.json(pref);
  } catch (err) {
    console.error("updatePreference error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const getMyRooms = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);

    const rooms = await ChatRoom.find({
      "participants.userId": userId
    }).sort({ "lastMessage.createdAt": -1 });

    const formattedRoomsRaw = await Promise.all(
      rooms.map(async (room: any) => {

        const lastMsg = await Message.findOne({
          roomId: room._id,
          isDeleted: { $ne: true },
          deletedFor: {
            $not: { $elemMatch: { userId } }
          }
        }).sort({ createdAt: -1 });

        if (!lastMsg && !room.isGroup) {

          const requestSenderId = String(room.chatRequestSenderId || "");
          const requestStatus = room.chatRequestStatus;

          // HIDE FOR SENDER IF REQUEST IS STILL PENDING
          if (
            requestSenderId === userId &&
            (
              requestStatus === "pending" ||
              requestStatus === "rejected"
            )
          ) {
            return null;
          }
        }
        const currentUserParticipant = room.participants.find(
          (p: any) => p.userId === userId
        );

        const otherParticipants = room.participants.filter(
          (p: any) => p.userId !== userId
        );

        let receiverName = "";
        let receiverProfilePath = null;

        if (!room.isGroup && otherParticipants.length > 0) {
          const user = otherParticipants[0];
          receiverName = `${user.first_Name} ${user.last_name}`;
          receiverProfilePath = user.profile_picture || null;
        }

        const groupMembers = room.participants.map((p: any) => ({
          userId: p.userId,
          fullName: `${p.first_Name} ${p.last_name}`,
          profile_picture: p.profile_picture || null,
          isOnline: false,
          unreadCount: p.unreadCount || 0,
          role: p.role,
          isAdmin: p.role === "admin"
        }));

        const receiverUserId =
          !room.isGroup && otherParticipants.length > 0
            ? otherParticipants[0].userId
            : null;

        const adminIds = room.participants
          .filter((p: any) => p.role === "admin")
          .map((p: any) => p.userId);

        const type = (lastMsg?.messageType || "").toLowerCase();

        const lastMessageText =
          type === MESSAGE_TYPES.Image
            ? "Photo"
            : type === MESSAGE_TYPES.Video
              ? "Video"
              : type === MESSAGE_TYPES.Video ? "Poll " : type === MESSAGE_TYPES.System
                ? lastMsg?.message : lastMsg?.message || ""

        return {
          _id: room._id,
          isGroup: room.isGroup,
          groupName: room.isGroup ? room.name : "",
          groupImage: room.groupImage || null,

          roomId: room.roomId,

          lastMessage: lastMessageText,
          lastMessageDate: lastMsg?.createdAt || null,

          isEdited: lastMsg?.isEdited || null,

          receiverName,
          receiverUserId,
          receiverProfilePath,

          isOnline: false,
          unreadCount: currentUserParticipant?.unreadCount || 0,

          adminIds,

          groupMembers: room.isGroup ? groupMembers : undefined,
          reaction: lastMsg?.reactions || "",
          chatRequestStatus: room?.chatRequestStatus,
          chatRequestSenderId: room?.chatRequestSenderId

        };
      })
    );

    const formattedRooms = formattedRoomsRaw.filter(room => room !== null);

    return res.json({
      status: true,
      data: formattedRooms
    });

  } catch (err) {
    console.error("getMyRooms error:", err);
    return res.status(500).json({ error: err });
  }
};

export const getRoomById = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.params;

    const room = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.json({
      status: true,
      data: room
    });
  } catch (err) {
    console.error("getRoomById error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const addParticipant = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, userIds } = req.body;

    const currentUserId = String(req.user!.id);

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        message: "userIds must be a non-empty array"
      });
    }

    const room: any = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const currentUser = room.participants.find(
      (p: any) =>
        String(p.userId?._id || p.userId) === currentUserId
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        message: "Only admin can add participants"
      });
    }

    const adminName =
      `${currentUser.first_Name} ${currentUser.last_name || ""}`.trim();

    const users: any[] = await User.findAll({
      where: { id: userIds },
      attributes: [
        "id",
        "first_name",
        "last_name",
        "profile_picture"
      ]
    });

    if (!users.length) {
      return res.status(400).json({
        message: "No valid users found"
      });
    }

    const existingUserIds = new Set(
      room.participants.map((p: any) =>
        String(p.userId?._id || p.userId).trim()
      )
    );

    const alreadyExists: string[] = [];
    const processedIds = new Set<string>();

    const newParticipants: any[] = [];

    for (const user of users) {
      const userId = String(user.id).trim();

      if (processedIds.has(userId)) {
        continue;
      }

      processedIds.add(userId);

      if (existingUserIds.has(userId)) {
        alreadyExists.push(userId);
        continue;
      }

      newParticipants.push({
        userId,
        first_Name: user.first_name,
        last_name: user.last_name,
        profile_picture: user.profile_picture
          ? process.env.PROFILE_URL + user.profile_picture
          : "",
        role: "member",
        joinedAt: new Date()
      });
    }

    let updatedRoom: any = room;

    if (newParticipants.length > 0) {
      updatedRoom = await ChatRoom.findByIdAndUpdate(
        roomId,
        {
          $push: {
            participants: {
              $each: newParticipants
            }
          },
          $set: {
            chatRequestStatus: "accepted"
          }
        },
        { returnDocument: "after" }
      );
    }

    // Create user preferences
    await Promise.all(
      newParticipants.map((p: any) =>
        UserPreference.updateOne(
          {
            userId: p.userId,
            roomId
          },
          {
            $setOnInsert: {
              userId: p.userId,
              roomId,
              notificationLevel: "all",
              isMuted: false,
              isPinned: false,
              isArchived: false
            }
          },
          {
            upsert: true
          }
        )
      )
    );

    let systemMessage = null;

    // Create single system message for added users
    if (newParticipants.length > 0) {

      const addedUserNames = newParticipants.map(
        (p: any) =>
          `${p.first_Name} ${p.last_name || ""}`.trim()
      );

      const message =
        `${adminName} added ${addedUserNames.join(", ")}`;

      systemMessage = await Messages.create({
        roomId,
        senderId: currentUserId,
        senderName: adminName,
        senderProfile: currentUser.profile_picture || null,
        message,
        messageType: "system"
      });

      // Update last message in chat room
      await ChatRoom.findByIdAndUpdate(
        roomId,
        {
          lastMessage: {
            text: systemMessage.message,
            senderId: currentUserId,
            createdAt: systemMessage.createdAt
          }
        }
      );
    }

    return res.json({
      status: true,
      addedCount: newParticipants.length,
      alreadyExistsCount: alreadyExists.length,
      alreadyExists,
      message:
        newParticipants.length > 0
          ? "Participants added successfully"
          : "All users already exist in group",
      data: updatedRoom,
      systemMessage
    });

  } catch (err) {
    console.error("addParticipant error:", err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const removeParticipant = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { roomId, userId } = req.body;

    const currentUserId = String(req.user!.id);

    const room: any = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const currentUser = room.participants.find(
      (p: any) => String(p.userId) === currentUserId
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        message: "Only admin can remove participants"
      });
    }

    if (String(userId) === currentUserId) {
      return res.status(400).json({
        message: "Admin cannot remove themselves"
      });
    }

    // Find user to remove before deleting
    const removedUser = room.participants.find(
      (p: any) => String(p.userId) === String(userId)
    );

    if (!removedUser) {
      return res.status(404).json({
        message: "Participant not found"
      });
    }

    const adminName =
      `${currentUser.first_Name} ${currentUser.last_name || ""}`.trim();

    const removedUserName =
      `${removedUser.first_Name} ${removedUser.last_name || ""}`.trim();

    // Remove participant
    const updatedRoom: any = await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        $pull: {
          participants: {
            userId: String(userId)
          }
        }
      },
      { returnDocument: "after" }
    );

    if (!updatedRoom) {
      return res.status(404).json({
        message: "Room not found after update"
      });
    }

    // Create system message
    const systemMessage = await Messages.create({
      roomId,
      senderId: currentUserId,
      senderName: adminName,
      senderProfile: currentUser.profile_picture || null,
      message: `${adminName} removed ${removedUserName}`,
      messageType: "system"
    });

    // Update room last message
    await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        lastMessage: {
          text: systemMessage.message,
          senderId: currentUserId,
          createdAt: systemMessage.createdAt
        }
      }
    );

    // If only one participant remains, delete the group
    if (updatedRoom.participants.length <= 1) {
      await ChatRoom.findByIdAndDelete(roomId);

      return res.json({
        status: true,
        message:
          "Group deleted as only one participant remained"
      });
    }

    return res.json({
      status: true,
      message: "Participant removed successfully",
      data: updatedRoom,
      systemMessage
    });

  } catch (err) {
    console.error(
      "removeParticipant error:",
      err
    );

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const leaveRoom = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = String(req.user!.id);
    const { roomId } = req.body;

    const room: any = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }
    const participant = room.participants.find(
      (p: any) =>
        String(p.userId?._id || p.userId) === userId
    );

    if (!participant) {
      return res.status(400).json({
        message: "User is not part of this room"
      });
    }

    if (participant.role === "admin") {
      return res.status(400).json({
        status: false,
        message: "Admin cannot leave the room"
      });
    }

    const userName =
      `${participant.first_Name} ${participant.last_name || ""}`.trim();

    // Remove participant from group
    const updatedRoom: any = await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        $pull: {
          participants: {
            userId: String(userId)
          }
        }
      },
      { returnDocument: "after" }
    );

    if (!updatedRoom) {
      return res.status(404).json({
        message: "Room not found after update"
      });
    }

    // Create system message
    const systemMessage = await Messages.create({
      roomId,
      senderId: userId,
      senderName: userName,
      senderProfile: participant.profile_picture || null,
      message: `${userName} left the group`,
      messageType: "system"
    });

    // Update room last message
    await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        lastMessage: {
          text: systemMessage.message,
          senderId: userId,
          createdAt: systemMessage.createdAt
        }
      }
    );

    return res.json({
      status: true,
      message: "You left the group successfully",
      data: updatedRoom,
      systemMessage
    });

  } catch (err) {
    console.error("leaveRoom error:", err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.query;

    const msg = await Message.findByIdAndUpdate(
      messageId,
      { isDeleted: true },
      { returnDocument: "after" }
    );

    return res.json({
      status: true,
      data: msg
    });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const { roomId } = req.query;

    // FIND ONLY USER PARTICIPATED ROOMS
    const roomMatch: any = {
      "participants.userId": userId
    };

    // OPTIONAL SINGLE ROOM VALIDATION
    if (roomId) {
      roomMatch._id = roomId;
    }

    const rooms = await ChatRoom.find(roomMatch)
      .select("_id")
      .lean();

    // NO ROOMS FOUND
    if (!rooms.length) {
      return res.json({
        status: true,
        totalUnreadMessages: 0,
        totalChatsUnread: 0,
        data: []
      });
    }

    const roomIds = rooms.map((room: any) => room._id);

    // UNREAD MESSAGE FILTER
    const match: any = {
      roomId: { $in: roomIds },

      // EXCLUDE OWN MESSAGES
      senderId: { $ne: userId },

      // NOT READ BY CURRENT USER
      readBy: {
        $not: {
          $elemMatch: {
            userId: userId
          }
        }
      },

      // EXCLUDE DELETED
      isDeleted: false
    };

    const result = await Message.aggregate([
      {
        $match: match
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

    // SINGLE ROOM RESPONSE
    if (roomId) {
      return res.json({
        status: true,
        roomId,
        unreadCount: result[0]?.unreadCount || 0
      });
    }

    // TOTAL UNREAD MESSAGES
    const totalUnreadMessages = result.reduce(
      (sum, room: any) => sum + room.unreadCount,
      0
    );

    // TOTAL CHATS HAVING UNREAD
    const totalChatsUnread = result.length;

    return res.json({
      status: true,
      totalUnreadMessages,
      totalChatsUnread,
      data: result
    });

  } catch (err) {
    console.error("getUnreadCount error:", err);

    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
};

export const getRoomMessagesPaginated = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const messages = await Message.find({ roomId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      status: true,
      data: messages
    });
  } catch (err) {
    console.error("getRoomMessagesPaginated error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const { roomId } = req.body;

    if (!roomId) {
      return res.status(400).json({
        message: "roomId is required"
      });
    }

    const result = await Message.updateMany(
      {
        roomId,
        senderId: { $ne: userId },
        "readBy.userId": { $ne: userId }
      },
      {
        $push: {
          readBy: {
            userId,
            readAt: new Date()
          }
        }
      }
    );

    return res.json({
      status: true,
      message: "Messages marked as read",
      updatedCount: result.modifiedCount
    });

  } catch (err) {
    console.error("markAsRead error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const saveDeviceToken = async (req: AuthRequest, res: Response) => {
  try {
    const { fcmToken, deviceType } = req.body;
    const userId = String(req.user!.id);

    if (!fcmToken || !deviceType) {
      return res.status(400).json({
        success: false,
        message: "fcmToken and deviceType are required"
      });
    }

    const device = await UserDevice.findOneAndUpdate(
      { userId },
      {
        fcmToken,
        deviceType,
        isActive: true
      },
      { upsert: true, returnDocument: "after" }
    );

    return res.json({
      success: true,
      message: "Device token saved successfully"
    });

  } catch (err) {
    console.error("saveDeviceToken error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const deleteMessageForMe = async (req: AuthRequest, res: Response) => {
  try {
    const { messageIds } = req.body; //
    const userId = String(req.user!.id);

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "messageIds required"
      });
    }

    const messages: any[] = await Message.find({
      _id: { $in: messageIds }
    });

    if (!messages.length) {
      return res.status(404).json({ status: false, message: "Messages not found" });
    }

    await Message.updateMany(
      { _id: { $in: messageIds } },
      {
        $addToSet: {
          deletedFor: {
            userId,
            deletedAt: new Date()
          }
        }
      }
    );

    const roomIds = [...new Set(messages.map(msg => String(msg.roomId)))];

    for (const roomId of roomIds) {
      const room: any = await ChatRoom.findById(roomId);

      if (!room) continue;

      // check if current lastMessage is deleted for this user
      const isLastMsgDeleted = messages.some(
        msg =>
          String(msg.roomId) === String(roomId) &&
          room.lastMessage?.createdAt &&
          msg.createdAt &&
          room.lastMessage.createdAt.toString() === msg.createdAt.toString()
      );

      if (isLastMsgDeleted) {
        const lastMsg = await Message.findOne({
          roomId,
          isDeleted: { $ne: true },
          deletedFor: {
            $not: { $elemMatch: { userId } }
          }
        }).sort({ createdAt: -1 });

        await ChatRoom.findByIdAndUpdate(roomId, {
          lastMessage: lastMsg
            ? {
              text: lastMsg.message,
              senderId: lastMsg.senderId,
              createdAt: lastMsg.createdAt
            }
            : null
        });
      }
    }

    return res.json({
      status: true,
      message: "Messages deleted for user successfully"
    });

  } catch (err) {
    console.error("deleteMessageForMe error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const clearChatforMe = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.query;
    const userId = String(req.user!.id);

    await Message.updateMany(
      { roomId }, {
      $addToSet: {
        deletedFor: {
          userId,
          deletedAt: new Date()
        }
      }
    }
    );

    // 2. find latest visible message
    const lastMsg = await Message.findOne({
      roomId,
      isDeleted: { $ne: true },
      deletedFor: {
        $not: {
          $elemMatch: { userId }
        }
      }
    }).sort({ createdAt: -1 });

    await ChatRoom.findOneAndUpdate(
      { _id: roomId },
      {
        lastMessage: lastMsg
          ? {
            text: lastMsg.message,
            senderId: lastMsg.senderId,
            createdAt: lastMsg.createdAt
          }
          : null
      }
    );

    return res.json({
      status: true,
      message: "Chat cleared successfully"
    });

  } catch (err) {
    console.error("clearChatforMe error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
}

export const getLastMessage = async (roomId: string, userId: string) => {
  return await Message.findOne({
    roomId,
    deletedFor: {
      $not: { $elemMatch: { userId } }
    }
  }).sort({ createdAt: -1 });
};

export const resetUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.body;
    const userId = String(req.user!.id);

    await ChatRoom.updateOne(
      { _id: roomId, "participants.userId": userId },
      {
        $set: {
          "participants.$.unreadCount": 0
        }
      }
    );

    return res.json({
      status: true
    });

  } catch (err) {
    console.error("resetUnreadCount error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const deleteForEveryone = async (req: AuthRequest, res: Response) => {
  try {
    const { messageIds } = req.body;
    const userId = String(req.user!.id);

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        status: false,
        message: "messageIds array is required"
      });
    }

    const messages: any[] = await Message.find({ _id: { $in: messageIds } });

    if (!messages.length) {
      return res.status(404).json({
        status: false,
        message: "Messages not found"
      });
    }

    const invalidMsg = messages.find(m => String(m.senderId) !== userId);
    if (invalidMsg) {
      return res.status(403).json({
        status: false,
        message: "You can delete only your own messages"
      });
    }

    const roomIds = [...new Set(messages.map(m => m.roomId.toString()))];
    if (roomIds.length !== 1) {
      return res.status(400).json({
        status: false,
        message: "All messages must belong to the same room"
      });
    }
    const roomId = roomIds[0];

    // Update messages: mark deleted and replace content
    await Message.updateMany(
      { _id: { $in: messageIds } },
      {
        $set: {
          isDeleted: true,
          message: "This message was deleted"
        }
      }
    );

    // Update last message in the chat room
    const lastMsg = await Message.findOne({
      roomId,
      isDeleted: { $ne: true }
    }).sort({ createdAt: -1 });

    const updatedLastMessage = lastMsg
      ? {
        text: lastMsg.message,
        senderId: lastMsg.senderId,
        createdAt: lastMsg.createdAt
      }
      : null;

    await ChatRoom.findByIdAndUpdate(roomId, { lastMessage: updatedLastMessage });

    const io = req.app.get("io");
    if (io) {
      io.to(roomId.toString()).emit("messages_deleted", {
        messageIds: messages.map(m => m._id),
        roomId
      });

      if (updatedLastMessage) {
        io.to(roomId.toString()).emit("last_message_updated", {
          roomId,
          lastMessage: updatedLastMessage
        });
      }
    }

    return res.json({
      status: true,
      message: "Messages deleted for everyone"
    });

  } catch (err: any) {
    console.error("Delete for everyone error:", err);

    return res.status(500).json({
      status: false,
      message: err.message || "Internal server error"
    });
  }
};

export const deleteUserDevice = async (req: AuthRequest, res: Response) => {
  try {
    const { fcmToken } = req.query;
    const userId = String(req.user!.id);

    if (!fcmToken) {
      return res.status(400).json({
        status: false,
        message: "fcmToken is required"
      });
    }

    const deletedDevice = await UserDevice.findOneAndDelete({
      userId,
      fcmToken
    });

    if (!deletedDevice) {
      return res.status(404).json({
        status: false,
        message: "Device not found"
      });
    }

    return res.json({
      status: true,
      message: "Device deleted successfully"
    });

  } catch (err: any) {
    console.error("Error while deleting user device", err);

    return res.status(500).json({
      status: false,
      message: err.message || "Internal server error"
    });
  }
};

export const createGroupsFromTeams = async (req: Request, res: Response) => {
  try {
    const sequelize = getSequelize();

    // 1. Get team users WITH role_id
    const teamUsers = await TeamUsers.findAll({
      where: {
        isDelete: 0,
        status: 1
      },
      attributes: ["team_id", "user_id", "team_role_ids"],
      raw: true
    });
    // 2. Group by team_id
    const teamMap: Record<string, any[]> = {};

    for (const row of teamUsers) {
      if (!teamMap[row.team_id]) {
        teamMap[row.team_id] = [];
      }
      teamMap[row.team_id].push(row);
    }

    const teamIds = Object.keys(teamMap);
    // const teamIds = ["4"];
    // 3. Fetch existing groups
    const existingRooms = await ChatRoom.find({
      isGroup: true,
      teamId: { $in: teamIds }
    });

    const existingRoomMap = new Map(
      existingRooms.map((room: any) => [String(room.teamId), room])
    );
    // 4. Fetch roles dynamically
    const [roles]: any = await sequelize.query(`
      SELECT id, title FROM roles 
      WHERE title IN ('admin', 'Team Manager','superadmin','Club President')
    `);

    const adminRoleIds = new Set(roles.map((r: any) => r.id));

    // 5. Fetch teams (logo + name)
    const [teams]: any = await sequelize.query(
      `SELECT id, logo, name FROM teams WHERE id IN (:teamIds)`,
      { replacements: { teamIds } }
    );

    const teamLogoMap: Record<string, string> = {};
    const teamNameMap: Record<string, string> = {};

    for (const t of teams) {
      if (t.logo) {
        teamLogoMap[String(t.id)] = process.env.TEAM_LOGO_URL + t.logo;
      }
      if (t.name) {
        teamNameMap[String(t.id)] = t.name;
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    // 6. Loop teams
    for (const teamId of teamIds) {
      const teamRows = teamMap[teamId];
      if (!teamRows.length) continue;

      const userIds = teamRows.map((r) => r.user_id);

      // 7. Fetch users
      const users: any = await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ["id", "first_name", "last_name", "profile_picture"],
        raw: true
      });

      if (!users.length) continue;

      // 8. Prepare participants
      const participants = users.map((u: any) => {
        const teamUser = teamRows.find(
          (r) => String(r.user_id) === String(u.id)
        );

        const roleIds = String(teamUser?.team_role_ids || "")
          .split(",")
          .map((id: string) => Number(id.trim()))
          .filter(Boolean);

        const isAdmin = roleIds.some((id: number) =>
          adminRoleIds.has(id)
        );

        return {
          userId: String(u.id),
          first_Name: u.first_name || "",
          last_name: u.last_name || "",
          profile_picture: u.profile_picture
            ? process.env.PROFILE_URL + u.profile_picture //  FIXED
            : "",
          role: isAdmin ? "admin" : "member",
          joinedAt: new Date()
        };
      });

      const groupImage = teamLogoMap[teamId] || null;
      const groupName = teamNameMap[teamId] || `Team ${teamId}`;

      const existingRoom = existingRoomMap.get(teamId);
      // 9. CREATE OR UPDATE
      if (!existingRoom) {
        //  CREATE
        await ChatRoom.create({
          name: groupName,
          isGroup: true,
          teamId,
          groupImage,
          chatRequestStatus: "accepted",
          participants,
          createdBy:
            participants.find((p: any) => p.role === "admin")?.userId ||
            participants[0]?.userId ||
            null
        });
        createdCount++;
      } else {
        //  UPDATE
        existingRoom.name = groupName;
        existingRoom.groupImage = groupImage;
        existingRoom.participants = participants;
        existingRoom.chatRequestStatus = "accepted"

        existingRoom.createdBy =
          participants.find((p: any) => p.role === "admin")?.userId ||
          participants[0]?.userId ||
          null;

        await existingRoom.save();

        updatedCount++;
      }
    }

    return res.json({
      status: true,
      message: "Groups processed successfully",
      totalTeams: teamIds.length,
      created: createdCount,
      updated: updatedCount
    });

  } catch (err) {
    console.error("create group error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const updateGroupDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, name, groupImage } = req.body;

    const systemMessages: string[] = [];

    const currentUserId = String(req.user!.id);

    const room: any = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    if (!room.isGroup) {
      return res.status(400).json({
        message: "This is not a group"
      });
    }

    const currentUser = room.participants.find(
      (p: any) => p.userId === currentUserId
    );

    if (!currentUser) {
      return res.status(403).json({
        message: "You are not part of this group"
      });
    }

    const userName =
      `${currentUser.first_Name} ${currentUser.last_name || ""}`.trim();

    const updateData: any = {};

    if (name !== undefined && name !== room.name) {
      updateData.name = name;

      systemMessages.push(
        `${userName} changed the group name to "${name}"`
      );
    }

    if (
      groupImage !== undefined &&
      groupImage !== room.groupImage
    ) {
      updateData.groupImage = groupImage;

      systemMessages.push(
        `${userName} changed the group icon`
      );
    }

    const updatedRoom = await ChatRoom.findByIdAndUpdate(
      roomId,
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!updatedRoom) {
      return res.status(404).json({
        message: "Room not found after update"
      });
    }

    // Create system messages
    let latestSystemMessage = null;

    for (const msg of systemMessages) {
      latestSystemMessage = await Messages.create({
        roomId,
        senderId: currentUserId,
        senderName: userName,
        senderProfile: currentUser.profile_picture,
        message: msg,
        messageType: "system"
      });
    }

    // Update room last message
    if (latestSystemMessage) {
      await ChatRoom.findByIdAndUpdate(
        roomId,
        {
          lastMessage: {
            text: latestSystemMessage.message,
            senderId: currentUserId,
            createdAt: new Date()
          }
        }
      );
    }

    const roomObj = updatedRoom.toObject();

    if (roomObj.groupImage) {
      roomObj.groupImage =
        process.env.TEAM_LOGO_URL + roomObj.groupImage;
    }

    return res.json({
      status: true,
      data: roomObj
    });

  } catch (err) {
    console.error("updateGroupDetails error:", err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const createPoll = async (req: AuthRequest, res: Response) => {
  try {

    const {
      roomId,
      question,
      options,
      allowMultipleAnswers = false
    } = req.body;

    const senderId = String(req.user?.id);

    if (!roomId) {
      return res.status(400).json({
        message: "roomId is required"
      });
    }

    if (!question) {
      return res.status(400).json({
        message: "question is required"
      });
    }

    if (
      !Array.isArray(options) ||
      options.length < 2
    ) {
      return res.status(400).json({
        message: "At least 2 options are required"
      });
    }

    const room: any = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const senderParticipant = room.participants.find(
      (p: any) => String(p.userId) === senderId
    );

    const senderName = senderParticipant
      ? `${senderParticipant.first_Name} ${senderParticipant.last_name}`
      : "Unknown";

    const senderProfile = senderParticipant?.profile_picture || null;

    const formattedOptions = options.map(
      (option: string, index: number) => ({
        optionId: new mongoose.Types.ObjectId().toString(),
        text: option,
        votes: []
      })
    );

    const msg = await Message.create({
      roomId,
      senderId,

      messageType: "poll",

      poll: {
        question,
        options: formattedOptions,
        allowMultipleAnswers
      },

      senderName,
      senderProfile
    });

    // UPDATE LAST MESSAGE
    await ChatRoom.findByIdAndUpdate(roomId, {
      lastMessage: {
        text: "📊 Poll",
        senderId,
        createdAt: new Date()
      }
    });

    return res.status(201).json({
      status: true,
      message: "Poll created successfully",
      data: msg
    });

  } catch (err) {

    console.error("createPoll error:", err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const createTeamSupportChat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { teamId } = req.body;

    const currentUser = req.user!;

    if (!teamId) {
      return res.status(400).json({
        status: false,
        message: "teamId is required"
      });
    }

    const sequelize = getSequelize();

    // GET TEAM
    const [teams]: any = await sequelize.query(
      `SELECT id, name, logo FROM teams WHERE id = :teamId`,
      {
        replacements: { teamId }
      }
    );

    const team = teams?.[0];

    if (!team) {
      return res.status(404).json({
        status: false,
        message: "Team not found"
      });
    }

    // FIND TEAM MANAGER ROLE
    // 4. Fetch roles dynamically
    const [roles]: any = await sequelize.query(`
      SELECT id, title FROM roles 
      WHERE title = 'Team Manager'
    `);

    const teamManagerRoleId = roles?.[0]?.id;


    if (!teamManagerRoleId) {
      return res.status(404).json({
        status: false,
        message: "Team Manager role not found"
      });
    }

    const managerTeamUsers: any = await TeamUsers.findAll({
      where: {
        team_id: teamId,
        isDelete: 0,
        status: 1,
        [Op.and]: [
          Sequelize.literal(
            `FIND_IN_SET(${Number(teamManagerRoleId)}, team_role_ids)`
          )
        ]
      },
      attributes: ["user_id"],
      raw: true
    });

    const managerUserIds = managerTeamUsers.map(
      (u: any) => u.user_id
    );

    if (!managerUserIds.length) {
      return res.status(404).json({
        status: false,
        message: "Team Manager not found"
      });
    }

    const managerUsers: any = await User.findAll({
      where: {
        id: {
          [Op.in]: managerUserIds
        }
      },
      attributes: [
        "id",
        "first_name",
        "last_name",
        "profile_picture"
      ],
      raw: true
    });

    if (!managerUsers.length) {
      return res.status(404).json({
        status: false,
        message: "Team Manager not found"
      });
    }


    // CHECK EXISTING CHAT
    const existingRoom = await ChatRoom.findOne({
      isGroup: true,
      teamId: String(teamId),
      createdBy: String(currentUser.id)
    });

    if (existingRoom) {
      return res.status(200).json({
        status: true,
        message: "Chat already exists for this team.",
        data: existingRoom
      });
    }

    const participants: any[] = [
      {
        userId: String(currentUser.id),
        first_Name: currentUser.first_name || "",
        last_name: currentUser.last_name || "",
        profile_picture: currentUser.profile_picture
          ? currentUser.profile_picture.startsWith("http")
            ? currentUser.profile_picture
            : `${process.env.PROFILE_URL}${currentUser.profile_picture}`
          : null,
        role: "member",
        joinedAt: new Date()
      }
    ];


    // ADD ALL TEAM MANAGERS AS ADMINS
    managerUsers.forEach((manager: any) => {

      participants.push({
        userId: String(manager.id),
        first_Name: manager.first_name || "",
        last_name: manager.last_name || "",
        profile_picture: manager.profile_picture
          ? manager.profile_picture.startsWith("http")
            ? manager.profile_picture
            : `${process.env.PROFILE_URL}${manager.profile_picture}`
          : null,
        role: "admin",
        joinedAt: new Date()
      });

    });



    // CREATE CHAT
    const room = await ChatRoom.create({
      name: team.name,
      isGroup: true,
      teamId: String(teamId),
      groupImage: team.logo ? process.env.TEAM_LOGO_URL + team.logo : "",
      chatRequestStatus: "accepted",

      participants,

      createdBy: String(currentUser.id)
    });

    const adminIds = managerUsers.map((m: any) => String(m.id));

    return res.status(201).json({
      status: true,
      message: "Chat created successfully",
      data: {
        ...room.toJSON(),
        adminIds
      }
    });

  } catch (error) {
    console.error("createTeamSupportChat error:", error);

    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
};

export const getUserRequests = async (
  req: AuthRequest,
  res: Response
) => {
  try {

    const loggedInUserId = String(req.user?.id);
    const searchTerm = String(req.query.searchTerm || "");

    const sequelize = getSequelize();

    // GET PLAYER ROLE
    const [roles]: any = await sequelize.query(`
      SELECT id, title
      FROM roles
      WHERE title = 'Player'
      LIMIT 1
    `);

    const playerRoleId = roles?.[0]?.id;

    if (!playerRoleId) {
      return res.status(404).json({
        status: false,
        message: "Player role not found"
      });
    }

    // GET PLAYERS
    const [users]: any = await sequelize.query(`
      SELECT DISTINCT
        u.user_id AS id,

        CONCAT(
          COALESCE(u.first_name, ''),
          ' ',
          COALESCE(u.last_name, '')
        ) AS name,

        u.profile_picture AS logo

      FROM users u

      INNER JOIN team_users tu
        ON tu.user_id = u.user_id

      WHERE
        FIND_IN_SET(:playerRoleId, tu.team_role_ids)
        AND (tu.isDelete = 0 OR tu.isDelete IS NULL)

        AND (
          CONCAT(
            COALESCE(u.first_name, ''),
            ' ',
            COALESCE(u.last_name, '')
          ) LIKE :search
        )
    `, {
      replacements: {
        playerRoleId,
        search: `%${searchTerm}%`
      }
    });

    // GET ALL PERSONAL CHATS OF LOGGED IN USER
    const chats = await ChatRoom.find({
      "participants.userId": loggedInUserId
    }).select(`
      participants
      chatRequestStatus
      chatRequestSenderId
    `);

    // STORE STATUS BY USER ID
    const requestStatusMap = new Map<string, string>();

    chats.forEach((chat: any) => {

      if (!chat?.participants?.length) {
        return;
      }

      // FIND OTHER USER
      const otherParticipant = chat.participants.find(
        (participant: any) =>
          String(participant.userId) !== loggedInUserId
      );

      if (!otherParticipant?.userId) {
        return;
      }

      const participantId = String(
        otherParticipant.userId
      );

      // ACCEPTED = FRIENDS
      if (chat.chatRequestStatus === "accepted") {

        requestStatusMap.set(
          participantId,
          "friends"
        );

      }

      // PENDING
      else if (
        chat.chatRequestStatus === "pending"
      ) {

        requestStatusMap.set(
          participantId,
          "requested"
        );

      }

      // REJECTED
      else {

        // ONLY SET NONE IF NO OTHER STATUS EXISTS
        if (
          !requestStatusMap.has(participantId)
        ) {

          requestStatusMap.set(
            participantId,
            "none"
          );

        }

      }

    });

    // FINAL RESPONSE
    const finalData = users.map((user: any) => ({

      id: String(user.id),

      name: user.name || "",

      logo: user.logo
        ? `${process.env.PROFILE_URL}${user.logo}`
        : null,

      requestStatus:
        requestStatusMap.get(
          String(user.id)
        ) || "none"

    }));

    return res.status(200).json({
      status: true,
      message: "Users fetched successfully",
      data: {
        players: finalData,
        count: finalData.length
      }
    });

  } catch (error: any) {

    return res.status(500).json({
      status: false,
      message:
        error.message ||
        "Internal server error"
    });

  }
};

export const deleteGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.query;
    const userId = String(req.user!.id);

    const room = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        status: false,
        message: "Chat room not found",
      });
    }

    if (!room.isGroup) {
      return res.status(400).json({
        status: false,
        message: "This is not a group chat",
      });
    }

    const participant = room.participants.find(
      (p) => p.userId === userId
    );

    if (!participant) {
      return res.status(403).json({
        status: false,
        message: "You are not part of this group",
      });
    }

    if (participant.role !== "admin") {
      return res.status(403).json({
        status: false,
        message: "Only admin can delete this group",
      });
    }

    await Message.deleteMany({ roomId });

    await ChatRoom.findByIdAndDelete(roomId);

    return res.json({
      status: true,
      message: "Group deleted successfully",
    });
  } catch (err) {
    console.error("deleteGroup error:", err);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};