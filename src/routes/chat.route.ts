// routes/chat.route.ts
import { Router } from "express";
import * as chatController from "../controllers/chat.controller";
import { authorize } from "../middleware/authorize";

const router = Router();

router.post(
  "/create-chat",
  authorize,
  chatController.createRoom
);

router.get(
  "/get-chat",
  authorize,
  chatController.getRoomMessages
);

router.get(
  "/get-my-room",
  authorize,
  chatController.getMyRooms
);

router.post(
  "/send-messages",
  authorize,
  chatController.sendMessage
);

router.put(
  "/update-preferance",
  authorize,
  chatController.updatePreference
);

router.post(
  "/add-participant",
  authorize,
  chatController.addParticipant
);

router.put(
  "/remove-participant",
  authorize,
  chatController.removeParticipant
);

router.put(
  "/leave-room",
  authorize,
  chatController.leaveRoom
);

router.delete(
  "/delete-message",
  authorize,
  chatController.deleteMessage
);

router.get(
  "/get-unread-count",
  authorize,
  chatController.getUnreadCount
);

router.get(
  "/get-room-messages-paginated",
  authorize,
  chatController.getRoomMessagesPaginated
);

router.put("/mark-as-read", authorize, chatController.markAsRead);

router.post("/save-device-token", authorize, chatController.saveDeviceToken);

router.put("/delete-message-for-me", authorize, chatController.deleteMessageForMe);

router.put("/clear-chat-for-me", authorize, chatController.clearChatforMe);

router.put("/delete-chat-for-everyone", authorize, chatController.deleteForEveryone);

router.post("/create-group-for-team", chatController.createGroupsFromTeams);

export default router;