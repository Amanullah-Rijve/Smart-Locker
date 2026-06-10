import express from "express";
import {
  getDashboard,
  getAllLockers,
  forceRelease,
  toggleMaintenance,
  getSessionHistory,
  getAllStudents,
  toggleStudentStatus,
} from "../controllers/admin.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

// সব admin route এ authMiddleware লাগবে
// login ছাড়া কেউ এখানে আসতে পারবে না
router.use(authMiddleware);

// ── Dashboard ─────────────────────────────────────────────
// GET /api/admin/dashboard
router.get("/dashboard", getDashboard);

// ── Lockers ───────────────────────────────────────────────
// GET /api/admin/lockers
router.get("/lockers", getAllLockers);

// POST /api/admin/lockers/:id/force-release
router.post("/lockers/:id/force-release", forceRelease);

// PATCH /api/admin/lockers/:id/maintenance
router.patch("/lockers/:id/maintenance", toggleMaintenance);

// ── Sessions ──────────────────────────────────────────────
// GET /api/admin/sessions
// GET /api/admin/sessions?status=active
// GET /api/admin/sessions?date=2024-11-01
// GET /api/admin/sessions?status=active&date=2024-11-01&limit=20
router.get("/sessions", getSessionHistory);

// ── Students ──────────────────────────────────────────────
// GET /api/admin/students
// GET /api/admin/students?active=true
router.get("/students", getAllStudents);

// PATCH /api/admin/students/:id/status
router.patch("/students/:id/status", toggleStudentStatus);

export default router;