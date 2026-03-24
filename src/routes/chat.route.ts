// routes/chat.route.ts
import { Router } from "express";
import * as chatController from "../controllers/chat.controller";
import { authorize } from "../middleware/authorize";

const router = Router();

router.post(
  "/create-chat",
  authorize,
  chatController.createChat
);


export default router;