import { Router } from "express";
import userRoutes from "./user.route";
import messageRoutes from "./chatMessage.route";
import chatRoutes from "./chat.route"

const router = Router();

// mount routes
router.use("/users", userRoutes);
router.use("/messages", messageRoutes);
router.use("/chat", chatRoutes);
// router.use("/reports", reportRoutes);
// router.use("/auth", authRoutes);

export default router;