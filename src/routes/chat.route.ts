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



export default router;