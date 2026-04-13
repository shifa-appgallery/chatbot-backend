// src/controllers/chatController.ts
import { Request, Response } from "express";
import ChatRoom from "../models/ChatRooms";
import Message from "../models/Messages";
import UserPreference from "../models/UserPreference";
import { AuthRequest } from "../middleware/authorize";
import { Op } from "sequelize";
import { User } from "../models/mysql/User";
import UserDevice from "../models/UserDevice";

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { name, participantIds = [], isGroup } = req.body;

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

    const formattedParticipantIds = participantIds.map((id: any) => String(id));

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

    if (!isGroup) {
      const existingRoom = await ChatRoom.findOne({
        isGroup: false,
        participants: {
          $size: 2,
          $all: uniqueParticipants.map((id: string) => ({
            $elemMatch: { userId: id }
          }))
        }
      });

      if (existingRoom) {
        return res.status(201).json({
          status: true,
          data: existingRoom
        })
      }
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
        profile_picture = currentUser.profile_picture || "";
      } else {
        const user = userMap[id];
        first_Name = user?.first_name || "";
        last_name = user?.last_name || "";
        profile_picture = user?.profile_picture || "";
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

    const room = await ChatRoom.create({
      name: isGroup ? name : "",
      isGroup: !!isGroup,
      participants,
      createdBy: currentUserId
    });

    // Create UserPreference for all participants
    await Promise.all(
      uniqueParticipants.map((userId: string) =>
        UserPreference.updateOne(
          { userId: String(userId), roomId: room._id },
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

    return res.status(201).json({
      status: true,
      data: room
    });

  } catch (err) {
    console.error("createRoom error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, message, messageType, mediaUrl } = req.body;
    const senderId = String(req.user!.id);

    const room = await ChatRoom.findOne({
      _id: roomId,
      "participants.userId": senderId
    });

    if (!room) {
      return res.status(403).json({
        message: "You are not part of this room"
      });
    }

    const deliveredTo = room.participants
      .filter((p: any) => p.userId !== senderId)
      .map((p: any) => ({
        userId: p.userId,
        deliveredAt: new Date()
      }));

    const msg = await Message.create({
      roomId,
      senderId,
      message,
      messageType,
      mediaUrl,
      deliveredTo   // 🔥 NEW (delivery tracking)
    });

    await ChatRoom.findByIdAndUpdate(roomId, {
      lastMessage: {
        text: message,
        senderId,
        createdAt: new Date()
      }
    });

    return res.status(201).json({
      status: true,
      data: msg
    });

  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const getRoomMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, start = '0', end = '3' } = req.query;
    const userId = String(req.user!.id);

    const startNum = parseInt(start as string, 10);
    const endNum = parseInt(end as string, 10);

    const now = new Date();

    const endDate = new Date();
    endDate.setDate(now.getDate() - startNum);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(now.getDate() - (endNum - 1));
    startDate.setHours(0, 0, 0, 0);

    const messages = await Message.find({
      roomId,
      // isDeleted: { $ne: true },
      deletedFor: {
        $not: {
          $elemMatch: { userId }
        }
      },
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    })
      .sort({ createdAt: 1 })
    return res.json({
      status: true,
      count: messages.length,
      data: messages
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

    const formattedRooms = await Promise.all(
      rooms.map(async (room: any) => {

        // 🔥 IMPORTANT: get last visible message
        const lastMsg = await Message.findOne({
          roomId: room._id,
          isDeleted: { $ne: true },
          deletedFor: {
            $not: { $elemMatch: { userId } }
          }
        }).sort({ createdAt: -1 });

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
          fullName: `${p.first_Name} ${p.last_name}`,
          profile_picture: p.profile_picture || null,
          isOnline: false,
          unreadCount: p.unreadCount || 0
        }));

        const receiverUserId =
          !room.isGroup && otherParticipants.length > 0
            ? otherParticipants[0].userId
            : null;

        return {
          _id: room._id,
          isGroup: room.isGroup,
          groupName: room.isGroup ? room.name : "",
          groupImage: room.groupImage || null,

          roomId: room.roomId,

          // ✅ FIXED HERE
          lastMessage: lastMsg?.message || "",
          lastMessageDate: lastMsg?.createdAt || null,

          receiverName,
          receiverUserId,
          receiverProfilePath,

          isOnline: false,
          unreadCount: currentUserParticipant?.unreadCount || 0,

          groupMembers: room.isGroup ? groupMembers : undefined
        };
      })
    );

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
    const { roomId, userId } = req.body;

    const user = await User.findOne({
      where: { id: userId },
      attributes: ["id"]
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid userId"
      });
    }

    const room = await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        $addToSet: {
          participants: {
            userId: String(userId),
            role: "member",
            joinedAt: new Date()
          }
        }
      },
      { returnDocument: "after" }
    );

    return res.json({
      status: true,
      data: room
    });
  } catch (err) {
    console.error("addParticipant error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const removeParticipant = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, userId } = req.body;

    const room = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const updatedRoom = await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        $pull: {
          participants: { userId: String(userId) }
        }
      },
      { returnDocument: "after" }
    );

    return res.json({
      status: true,
      data: updatedRoom
    });
  } catch (err) {
    console.error("removeParticipant error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const leaveRoom = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const { roomId } = req.body;

    const room = await ChatRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found"
      });
    }

    const updatedRoom = await ChatRoom.findByIdAndUpdate(
      roomId,
      {
        $pull: {
          participants: { userId }
        }
      },
      { returnDocument: "after" }
    );

    return res.json({
      status: true,
      data: updatedRoom
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
    const { roomId } = req.query; // 👈 optional

    const match: any = {
      senderId: { $ne: userId }, // ❗ don't count own messages
      "readBy.userId": { $ne: userId }
    };

    if (roomId) {
      match.roomId = roomId;
    }

    const result = await Message.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$roomId",
          unreadCount: { $sum: 1 }
        }
      }
    ]);

    if (roomId) {
      return res.json({
        roomId,
        unreadCount: result[0]?.unreadCount || 0
      });
    }

    return res.json({
      status: true,
      data: result
    });

  } catch (err) {
    console.error("getUnreadCount error:", err);
    return res.status(500).json({
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
        senderId: { $ne: userId }, // ❗ don't mark own messages
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

    console.log("Device token saved:", device?._id);

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