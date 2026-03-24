import { Router, Request, Response } from "express";
import { authorize } from "../middleware/authorize";
import * as userController from "../controllers/user.controller";

const router = Router();

router.post(
  "/login-with-token",
  authorize,
  userController.loginWithToken
);

export default router;