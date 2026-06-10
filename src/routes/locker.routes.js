import express from "express";
import {
  scanCard,
  getAllLockerStatus,
  getLockerDetail,
} from "../controllers/locker.controller.js";
import deviceMiddleware from "../middleware/device.middleware.js";

const router = express.Router();

// POST /api/locker/scan — ESP32 এই route call করবে
// deviceMiddleware — শুধু ESP32 access করতে পারবে
router.post("/scan", deviceMiddleware, scanCard);

// GET /api/locker/status — সব locker এর status
// Public — student UI তে দেখাবে
router.get("/status", getAllLockerStatus);

// GET /api/locker/:lockerNumber — একটা locker এর detail
// Public
router.get("/:lockerNumber", getLockerDetail);

export default router;