import { Server, Socket } from "socket.io";
import ChatRooms from "../models/ChatRooms";
import Messages from "../models/Messages";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

interface SendMessagePayload {
  roomId: string;
  message: string;
  messageType?: string;
  mediaUrl?: string | null;
}

interface MarkReadPayload {
  roomId: string;
}

interface MarkDeliveredPayload {
  roomId: string;
}

export default (socket: AuthenticatedSocket, io: Server) => {

  // ✅ SEND MESSAGE
  socket.on("send_message", async ({
    roomId,
    message,
    messageType,
    mediaUrl
  }: SendMessagePayload) => {

    const senderId = String(socket.user?._id);

    const msg = await Messages.create({
      roomId,
      senderId,
      message,
      messageType: messageType || "text",
      mediaUrl: mediaUrl || null
    });

    // ✅ update chat room last message
    await ChatRooms.findByIdAndUpdate(roomId, {
      lastMessage: {
        text: message,
        senderId,
        createdAt: new Date()
      }
    });

    // ✅ send to all users in room
    io.to(roomId.toString()).emit("receive_message", msg);

    // ✅ SINGLE TICK (important 🔥)
    socket.emit("message_sent", msg);
  });

  // ✅ MARK AS DELIVERED
  socket.on("mark_delivered", async ({ roomId }: MarkDeliveredPayload) => {
    const userId = String(socket.user?._id);

    await Messages.updateMany(
      { roomId, "deliveredTo.userId": { $ne: userId } },
      {
        $addToSet: {
          deliveredTo: {
            userId,
            deliveredAt: new Date()
          }
        }
      }
    );

    socket.to(roomId.toString()).emit("messages_delivered", { userId });
  });

  // ✅ MARK AS READ
  socket.on("mark_read", async ({ roomId }: MarkReadPayload) => {
    const userId = String(socket.user?._id);

    await Messages.updateMany(
      { roomId, "readBy.userId": { $ne: userId } },
      {
        $addToSet: {
          readBy: {
            userId,
            readAt: new Date()
          }
        }
      }
    );

    socket.to(roomId.toString()).emit("messages_read", { userId });
  });

};