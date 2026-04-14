import { Router } from "express";
import chatRoutes from "./chat.route"
import adminRoutes from "./admin.route"

const router = Router();

// mount routes
router.use("/chat", chatRoutes);
router.use("/admin", adminRoutes);

export default router;