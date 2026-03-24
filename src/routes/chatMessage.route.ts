import { Router } from "express";
import { authorize } from "../middleware/authorize";
import * as messageController from "../controllers/chatMessage.controller"

const router = Router();

router.post("/create-message", authorize, messageController.createMessage);
router.get("/get-message-by-chat", authorize, messageController.getMessagesByRoom);
router.put("/update-message", authorize, messageController.updateMessage);
router.delete("/delete-message", authorize, messageController.deleteMessage);

export default router;