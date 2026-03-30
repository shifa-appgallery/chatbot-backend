import { Router } from "express";
import chatRoutes from "./chat.route"

const router = Router();

// mount routes
router.use("/chat", chatRoutes);

export default router;