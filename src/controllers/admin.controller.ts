import { Op } from "sequelize";
import { getSequelize } from "../config/mysql";
import { AuthRequest } from "../middleware/authorize";
import { TeamUsers } from "../models/mysql/TeamUsers";
import { User } from "../models/mysql/User";
import ChatRooms from "../models/ChatRooms";
import UserPreference from "../models/UserPreference";
import { Response } from "express";
import { PROFILE_URL, TEAM_LOGO_URL } from "../constant/url";


export const createGroupByRole = async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.body;
    const currentUser = req.user!;
    const userId = currentUser.id;

    if (!teamId) {
      return res.status(400).json({
        message: "teamId is required"
      });
    }

    const sequelize = getSequelize();

    const teamUser: any = await TeamUsers.findOne({
      where: {
        user_id: userId,
        team_id: teamId,
        isDelete: 0,
        status: 1
      },
      raw: true
    });

    if (!teamUser) {
      return res.status(403).json({
        message: "You are not part of this team"
      });
    }

    const userWithRole: any = await User.findOne({
      where: { id: userId },
      attributes: ["id", "role_id"],
      raw: true
    });

    const [roles]: any = await sequelize.query(`
      SELECT id, title FROM roles 
      WHERE id = ${userWithRole.role_id}
    `);


    const roleTitle = roles?.[0]?.title;

    if (!["admin", "Team Manager", "superadmin"].includes(roleTitle)) {
      return res.status(403).json({
        message: "Only admin or team manager can create group"
      });
    }

    const [teams]: any = await sequelize.query(
      `SELECT id, name, logo FROM teams WHERE id = :teamId`,
      { replacements: { teamId } }
    );

    const team = teams?.[0];

    if (!team) {
      return res.status(404).json({
        message: "Team not found"
      });
    }

    const groupName = team.name;
    const groupImage = team.logo ? TEAM_LOGO_URL + team.logo : null;

    const teamUsers = await TeamUsers.findAll({
      where: {
        team_id: teamId,
        isDelete: 0,
        status: 1
      },
      attributes: ["user_id"],
      raw: true
    });

    const userIds = teamUsers.map((t: any) => t.user_id);

    const users: any = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ["id", "first_name", "last_name", "profile_picture"],
      raw: true
    });

    const participants = users.map((u: any) => ({
      userId: String(u.id),
      first_Name: u.first_name || "",
      last_name: u.last_name || "",
      profile_picture: u.profile_picture
        ? PROFILE_URL + u.profile_picture
        : "",
      role: u.id === userId ? "admin" : "member",
      joinedAt: new Date()
    }));

    const existingRoom = await ChatRooms.findOne({
      teamId: String(teamId),
      isGroup: true
    }).lean();
    console.log("existingRoom", existingRoom)

    if (existingRoom) {
      return res.status(409).json({
        status: false,
        message: "Group already exists for this team"
      });
    }

    const room = await ChatRooms.create({
      name: groupName,
      isGroup: true,
      teamId,
      groupImage,
      participants,
      createdBy: String(userId)
    });

    await Promise.all(
      participants.map((p: any) =>
        UserPreference.updateOne(
          { userId: p.userId, roomId: room._id },
          {
            $setOnInsert: {
              userId: p.userId,
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
      message: "Group created successfully",
      data: room
    });

  } catch (err) {
    console.error("createGroupByRole error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};


export const addMembersToGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, userIds = [] } = req.body;
    const currentUserId = String(req.user!.id);

    if (!roomId || !userIds.length) {
      return res.status(400).json({
        message: "roomId and userIds are required"
      });
    }

    const sequelize = getSequelize();

    const userWithRole: any = await User.findOne({
      where: { id: currentUserId },
      attributes: ["id", "role_id"],
      raw: true
    });

    const [roles]: any = await sequelize.query(`
      SELECT id, title FROM roles 
      WHERE id = ${userWithRole.role_id}
    `);

    const roleTitle = roles?.[0]?.title;

    if (!["admin", "Team Manager", "superadmin"].includes(roleTitle)) {
      return res.status(403).json({
        message: "Only admin or team manager can add members"
      });
    }

    const room: any = await ChatRooms.findById(roomId);

    if (!room || !room.isGroup) {
      return res.status(404).json({
        message: "Group not found"
      });
    }

    const currentUser = room.participants.find(
      (p: any) => p.userId === currentUserId
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        message: "Only group admin can add members"
      });
    }

    const existingUserIds = room.participants.map((p: any) => p.userId);

    const newUserIds = userIds
      .map(String)
      .filter((id: string) => !existingUserIds.includes(id));

    if (!newUserIds.length) {
      return res.status(400).json({
        message: "All users already exist in group"
      });
    }

    const users: any = await User.findAll({
      where: { id: { [Op.in]: newUserIds } },
      attributes: ["id", "first_name", "last_name", "profile_picture"],
      raw: true
    });

    const newParticipants = users.map((u: any) => ({
      userId: String(u.id),
      first_Name: u.first_name || "",
      last_name: u.last_name || "",
      profile_picture: u.profile_picture
        ? PROFILE_URL + u.profile_picture
        : "",
      role: "member",
      joinedAt: new Date()
    }));

    room.participants.push(...newParticipants);

    await room.save();

    await Promise.all(
      newParticipants.map((p: any) =>
        UserPreference.updateOne(
          { userId: p.userId, roomId: room._id },
          {
            $setOnInsert: {
              userId: p.userId,
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

    return res.status(200).json({
      status: true,
      message: "Members added successfully",
      data: room
    });

  } catch (err) {
    console.error("addMembersToGroup error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const removeMemberFromGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId, userIdToRemove } = req.body;
    const currentUserId = String(req.user!.id);

    if (!roomId || !userIdToRemove) {
      return res.status(400).json({
        message: "roomId and userIdToRemove are required"
      });
    }

    const sequelize = getSequelize();

    const userWithRole: any = await User.findOne({
      where: { id: currentUserId },
      attributes: ["id", "role_id"],
      raw: true
    });

    const [roles]: any = await sequelize.query(
      `SELECT id, title FROM roles WHERE id = :roleId`,
      { replacements: { roleId: userWithRole.role_id } }
    );

    const roleTitle = roles?.[0]?.title;

    if (!["admin", "Team Manager", "superadmin"].includes(roleTitle)) {
      return res.status(403).json({
        message: "Only admin or team manager can remove members"
      });
    }

    const room: any = await ChatRooms.findById(roomId);

    if (!room || !room.isGroup) {
      return res.status(404).json({
        message: "Group not found"
      });
    }

    const currentUser = room.participants.find(
      (p: any) => p.userId === currentUserId
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        message: "Only group admin can remove members"
      });
    }

    if (currentUserId === String(userIdToRemove)) {
      return res.status(400).json({
        message: "Admin cannot remove themselves"
      });
    }

    const beforeCount = room.participants.length;

    room.participants = room.participants.filter(
      (p: any) => p.userId !== String(userIdToRemove)
    );

    if (room.participants.length === beforeCount) {
      return res.status(404).json({
        message: "User not found in group"
      });
    }

    await room.save();

    return res.status(200).json({
      status: true,
      message: "Member removed successfully",
      data: room
    });

  } catch (err) {
    console.error("removeMemberFromGroup error:", err);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};