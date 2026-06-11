import { Router } from "express";
import { authorize } from "../middleware/authorize";
import * as adminController from "../controllers/admin.controller";

const router = Router();


router.post(
  "/create-group-chat",
  authorize,
  adminController.createGroupByRole
);

router.post(
  "/add-member-to-group",
  authorize,
  adminController.addMembersToGroup
);

router.post(
  "/remove-member-from-group",
  authorize,
  adminController.removeMemberFromGroup
);

export default router;