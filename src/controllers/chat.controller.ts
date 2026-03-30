// src/controllers/chatController.ts
import { Request, Response } from "express";
import ChatRoom from "../models/ChatRooms";
import Message from "../models/Messages";
import UserPreference from "../models/UserPreference";
import { AuthRequest } from "../middleware/authorize";
import { Op } from "sequelize";
import { User } from "../models/mysql/User";

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { name, participantIds = [], isGroup } = req.body;

    const currentUserId = String(req.user!.id);

    // ❌ Empty participants
    if (!participantIds.length) {
      return res.status(400).json({
        message: "participantIds are required"
      });
    }

    // ❌ Prevent self-add
    if (participantIds.map(String).includes(currentUserId)) {
      return res.status(400).json({
        message: "You cannot add yourself"
      });
    }

    // ✅ Convert all IDs to string (IMPORTANT)
    const formattedParticipantIds = participantIds.map((id: any) => String(id));

    // ✅ Validate users from MySQL
    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: formattedParticipantIds
        }
      },
      attributes: ["id"]
    });

    if (users.length !== formattedParticipantIds.length) {
      return res.status(400).json({
        message: "Some participantIds are invalid"
      });
    }

    // ✅ Include current user
    const uniqueParticipants = [
      ...new Set([currentUserId, ...formattedParticipantIds])
    ];

    // ❌ 1-1 validation
    if (!isGroup && uniqueParticipants.length !== 2) {
      return res.status(400).json({
        message: "1-1 chat must have exactly 2 users"
      });
    }

    // ✅ 🔥 FIXED Duplicate Check
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
        return res.status(200).json(existingRoom);
      }
    }

    // ❌ Group validation
    if (isGroup && !name) {
      return res.status(400).json({
        message: "Group name is required"
      });
    }

    // ✅ Create room
    const room = await ChatRoom.create({
      name: isGroup ? name : "",
      isGroup: !!isGroup,
      participants: uniqueParticipants.map((id: string) => ({
        userId: id,
        role: id === currentUserId ? "admin" : "member",
        joinedAt: new Date()
      })),
      createdBy: currentUserId
    });

    return res.status(201).json(room);

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

    // ✅ Check if user belongs to room
    const room = await ChatRoom.findOne({
      _id: roomId,
      "participants.userId": senderId
    });

    if (!room) {
      return res.status(403).json({
        message: "You are not part of this room"
      });
    }

    // ✅ Prepare deliveredTo (all except sender)
    const deliveredTo = room.participants
      .filter((p: any) => p.userId !== senderId)
      .map((p: any) => ({
        userId: p.userId,
        deliveredAt: new Date()
      }));

    // ✅ Create message
    const msg = await Message.create({
      roomId,
      senderId,
      message,
      messageType,
      mediaUrl,
      deliveredTo   // 🔥 NEW (delivery tracking)
    });

    // ✅ Update last message in room
    await ChatRoom.findByIdAndUpdate(roomId, {
      lastMessage: {
        text: message,
        senderId,
        createdAt: new Date()
      }
    });

    return res.status(201).json(msg);

  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const getRoomMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.query;
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
    return res.json(messages);
  } catch (err) {
    return res.status(500).json({ error: err });
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
      { upsert: true, new: true }
    );

    return res.json(pref);
  } catch (err) {
    return res.status(500).json({ error: err });
  }
};

export const getMyRooms = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);

    const rooms = await ChatRoom.find({
      "participants.userId": userId
    }).sort({ updatedAt: -1 });

    return res.json(rooms);
  } catch (err) {
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

    return res.json(room);
  } catch (err) {
    return res.status(500).json({ error: err });
  }
};

export const addParticipant = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, userId } = req.body;

    // ✅ Validate user from MySQL
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
      { new: true }
    );

    return res.json(room);
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
      { new: true }
    );

    return res.json(updatedRoom);
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
    console.log("userId",userId)

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
      { new: true }
    );

    return res.json(updatedRoom);
  } catch (err) {
    console.error("leaveRoom error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;

    const msg = await Message.findByIdAndUpdate(
      messageId,
      { isDeleted: true },
      { new: true }
    );

    return res.json(msg);
  } catch (err) {
    return res.status(500).json({ error: err });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const { roomId } = req.query; // 👈 optional

    // ✅ Base match
    const match: any = {
      senderId: { $ne: userId }, // ❗ don't count own messages
      "readBy.userId": { $ne: userId }
    };

    // ✅ If specific room requested
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

    // ✅ If roomId passed → return single number
    if (roomId) {
      return res.json({
        roomId,
        unreadCount: result[0]?.unreadCount || 0
      });
    }

    // ✅ Otherwise return all rooms
    return res.json(result);

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

    return res.json(messages);
  } catch (err) {
    return res.status(500).json({ error: err });
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

    // ✅ Update all unread messages in this room
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