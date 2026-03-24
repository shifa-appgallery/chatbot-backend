// controllers/chat.controller.ts
import { Request, Response } from "express";
import Chat from "../models/Chat";
import { v4 as uuidv4 } from "uuid";

// Create a 1-to-1 or group chat
export const createChat = async (req: Request, res: Response) => {
  try {
    const { userIds, isGroup, groupName } = req.body;
    if (!userIds || userIds.length < 2)
      return res.status(400).json({ error: "At least 2 users required" });

    // Generate unique roomId
    const roomId = uuidv4();

    const chat = await Chat.create({
      users: userIds,
      isGroupChat: isGroup || false,
      name: isGroup ? groupName : undefined,
      roomId,
    });

    res.status(201).json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create chat" });
  }
};