import { Request, Response } from "express";
import ChatMessage from "../models/ChatMessage";

// CREATE a new message
export const createMessage = async (req: Request, res: Response) => {
  try {
    const { userId, roomId, message, messageType, mediaUrl } = req.body;

    const newMessage = await ChatMessage.create({
      senderId: userId,
      roomId,
      message,
      messageType,
      mediaUrl,
    });

    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create message" });
  }
};

// GET messages of a room
export const getMessagesByRoom = async (req: Request, res: Response) => {
  try {
    const { roomId } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const messages = await ChatMessage.find({ roomId })
      .populate("senderId", "name email")
      .populate("messageReadBy.userId", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      page,
      limit,
      messages: messages.reverse(), // oldest → newest
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// UPDATE a message (only sender can edit)
export const updateMessage = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.query;
    const { message } = req.body;
    const userId = (req as any).user.id;

    const msg = await ChatMessage.findById(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId.toString() !== userId)
      return res.status(403).json({ error: "Not allowed" });

    msg.message = message;
    await msg.save();

    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update message" });
  }
};

// DELETE a message (only sender can delete)
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.query;
    const userId = (req as any).user.id;

    const msg = await ChatMessage.findById(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId.toString() !== userId)
      return res.status(403).json({ error: "Not allowed" });

    await msg.deleteOne();
    res.json({ message: "Message deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete message" });
  }
};