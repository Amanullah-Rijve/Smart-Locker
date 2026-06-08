import express from 'express';
import {
  adminLogin,
  verifyAdminOTP,
  updateAdminProfile,
} from "../controllers/auth.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/login", adminLogin);
router.post("/verify-otp", verifyAdminOTP);
router.patch("/update-profile", authMiddleware, updateAdminProfile);

export default router;