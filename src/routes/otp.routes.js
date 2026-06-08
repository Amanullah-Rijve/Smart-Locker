import express from "express";
import {
  registerStudent,
  verifyRegistration,
} from "../controllers/otp.controller.js";

const router = express.Router();

// POST /api/otp/register — student info দাও, OTP পাঠাবে
router.post("/register", registerStudent);

// POST /api/otp/verify-registration — OTP দাও, registered হবে
router.post("/verify-registration", verifyRegistration);

export default router;