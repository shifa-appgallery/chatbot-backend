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

    // ✅ Fetch users from MySQL
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
    const { roomId } = req.query;
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
    return res.json({
      status: true,
      data: messages
    });
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
      { upsert: true, returnDocument: "after" }
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
      "participants.userId": userId,
      lastMessage: { $exists: true, $ne: null }
    }).sort({ updatedAt: -1 });

    const formattedRooms = rooms.map((room: any) => {
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

      const receiverUserId = !room.isGroup && otherParticipants.length > 0
        ? otherParticipants[0].userId
        : null;

      return {
        _id: room._id,
        isGroup: room.isGroup,
        groupName: room.isGroup ? room.name : "",
        groupImage: room.groupImage || null,

        roomId: room.roomId,

        lastMessage: room.lastMessage?.text || "",
        lastMessageDate: room.lastMessage?.createdAt || null,

        receiverName,
        receiverUserId,
        receiverProfilePath,

        isOnline: false, // 🔥 socket later
        unreadCount: currentUserParticipant?.unreadCount || 0,

        groupMembers: room.isGroup ? groupMembers : undefined
      };
    });

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
    return res.status(500).json({ error: err });
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
    const { messageId } = req.params;

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
    return res.status(500).json({ error: err });
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
  const { fcmToken, deviceType } = req.body;
  const userId = String(req.user!.id);

  await UserDevice.findOneAndUpdate(
    { userId },
    {
      fcmToken,
      deviceType,
      isActive: true
    },
    { upsert: true, returnDocument: "after" }
  );

  res.json({ success: true });
};