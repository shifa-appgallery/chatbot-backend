import { Socket, Server } from "socket.io";
import Chat from "../models/ChatMessage";

interface OnlineUser {
  socketId: string;
  lastSeen: Date;
}

// Currently online users
const onlineUsers: Record<string, OnlineUser> = {};

// Keep last seen of offline users
const lastSeenUsers: Record<string, Date> = {};

export const chatHandler = (io: Server, socket: Socket) => {
  const userId = (socket as any).user.id;

  // Add to online users and notify everyone
  onlineUsers[userId] = { socketId: socket.id, lastSeen: new Date() };
  io.emit("user_online", { userId });

  console.log(`User ${userId} connected`);

  // Join personal room
  socket.join(userId);

  /** -------------------- CHAT ROOM EVENTS -------------------- **/

  // Join a chat room
  socket.on("join_chat", (roomId: string) => {
    socket.join(roomId);
    console.log(`User ${userId} joined room ${roomId}`);
  });

  // Send a message
  socket.on(
    "send_message",
    async (data: { roomId: string; message: string; messageType: string; mediaUrl?: string }) => {
      const { roomId, message, messageType, mediaUrl } = data;

      const newMessage = await Chat.create({
        senderId: userId,
        roomId,
        message,
        messageType,
        mediaUrl,
      });

      // Broadcast message to all users in the room
      io.to(roomId).emit("receive_message", {
        ...newMessage.toObject(),
        senderId: userId,
      });
    }
  );

  // Typing indicators
  socket.on("typing", (roomId: string) => {
    console.log(`Typing from ${userId} in room ${roomId}`); // ✅ HERE
    socket.to(roomId).emit("typing", { userId });
  });


  socket.on("stop_typing", (roomId: string) => {
    socket.to(roomId).emit("stop_typing", { userId });
  });

  // Mark messages as seen
  socket.on("mark_seen", async (roomId: string) => {
    await Chat.updateMany(
      { roomId, "messageReadBy.userId": { $ne: userId } },
      { $push: { messageReadBy: { userId, readAt: new Date() } } }
    );

    socket.to(roomId).emit("messages_seen", { userId });
  });

  /** -------------------- USER STATUS EVENTS -------------------- **/

  // Get user online status
  socket.on(
    "get_user_status",
    (targetUserId: string, callback: (status: { online: boolean; lastSeen: Date | null }) => void) => {
      if (onlineUsers[targetUserId]) {
        callback({ online: true, lastSeen: null });
      } else {
        callback({ online: false, lastSeen: lastSeenUsers[targetUserId] || null });
      }
    }
  );

  /** -------------------- DISCONNECT -------------------- **/

  socket.on("disconnect", () => {
    const now = new Date();

    // Remove from online users, save last seen
    delete onlineUsers[userId];
    lastSeenUsers[userId] = now;

    // Notify everyone that the user went offline
    io.emit("user_offline", { userId, lastSeen: now });
    console.log(`User ${userId} disconnected, last seen: ${now.toISOString()}`);
  });
};