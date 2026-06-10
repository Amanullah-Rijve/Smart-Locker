import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();

// ─────────────────────────────────────────────────────────
// Dashboard summary
// GET /api/admin/dashboard
// ─────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    // সব locker count
    const [lockerStats] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'available')   AS available,
         SUM(status = 'occupied')    AS occupied,
         SUM(status = 'maintenance') AS maintenance
       FROM lockers`
    );

    // আজকের session count
    const [todayStats] = await pool.query(
      `SELECT
         COUNT(*) AS total_today,
         SUM(status = 'active')   AS active_now,
         SUM(status = 'released') AS released_today,
         SUM(status = 'expired')  AS expired_today
       FROM sessions
       WHERE DATE(claimed_at) = CURDATE()`
    );

    // Total registered students
    const [studentStats] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(is_active = 1) AS active
       FROM students`
    );

    return res.status(200).json({
      success: true,
      dashboard: {
        lockers:  lockerStats[0],
        today:    todayStats[0],
        students: studentStats[0],
      },
    });

  } catch (err) {
    console.error("Dashboard error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// সব locker detail — admin view
// GET /api/admin/lockers
// ─────────────────────────────────────────────────────────
export const getAllLockers = async (req, res) => {
  try {
    const [lockers] = await pool.query(
      `SELECT
         l.id,
         l.locker_number,
         l.location,
         l.status,
         l.updated_at,
         st.name         AS student_name,
         st.student_code AS student_code,
         st.email        AS student_email,
         st.phone        AS student_phone,
         se.id           AS session_id,
         se.claimed_at,
         TIMESTAMPDIFF(MINUTE, se.claimed_at, NOW()) AS minutes_used,
         (${process.env.SESSION_TIMEOUT_HOURS} * 60) -
         TIMESTAMPDIFF(MINUTE, se.claimed_at, NOW()) AS minutes_remaining
       FROM lockers l
       LEFT JOIN sessions se
         ON se.locker_id = l.id AND se.status = 'active'
       LEFT JOIN students st
         ON st.id = se.student_id
       ORDER BY CAST(l.locker_number AS UNSIGNED)`
    );

    return res.status(200).json({
      success: true,
      count: lockers.length,
      lockers,
    });

  } catch (err) {
    console.error("Get lockers error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// Force release — যেকোনো locker জোর করে খুলে দাও
// POST /api/admin/lockers/:id/force-release
// ─────────────────────────────────────────────────────────
export const forceRelease = async (req, res) => {
  const { id } = req.params;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Locker আছে কিনা check
    const [lockers] = await conn.query(
      "SELECT * FROM lockers WHERE id = ?",
      [id]
    );

    if (!lockers.length) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "Locker not found.",
      });
    }

    const locker = lockers[0];

    // Active session থাকলে release করো
    const [sessions] = await conn.query(
      "SELECT id FROM sessions WHERE locker_id = ? AND status = 'active'",
      [id]
    );

    if (sessions.length) {
      await conn.query(
        `UPDATE sessions 
         SET status = 'released', released_at = NOW() 
         WHERE id = ?`,
        [sessions[0].id]
      );
    }

    // Locker available করো
    await conn.query(
      "UPDATE lockers SET status = 'available' WHERE id = ?",
      [id]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: `Locker ${locker.locker_number} forcefully released by admin.`,
    });

  } catch (err) {
    await conn.rollback();
    console.error("Force release error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// Locker maintenance mode toggle
// PATCH /api/admin/lockers/:id/maintenance
// Body: { maintenance: true | false }
// ─────────────────────────────────────────────────────────
export const toggleMaintenance = async (req, res) => {
  const { id } = req.params;
  const { maintenance } = req.body;

  if (typeof maintenance !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "maintenance field must be true or false.",
    });
  }

  try {
    // Maintenance mode এ দেওয়ার আগে active session check
    if (maintenance) {
      const [sessions] = await pool.query(
        "SELECT id FROM sessions WHERE locker_id = ? AND status = 'active'",
        [id]
      );

      if (sessions.length) {
        return res.status(409).json({
          success: false,
          message: "Cannot set to maintenance. Locker is currently in use. Force release first.",
        });
      }
    }

    const newStatus = maintenance ? "maintenance" : "available";

    await pool.query(
      "UPDATE lockers SET status = ? WHERE id = ?",
      [newStatus, id]
    );

    return res.status(200).json({
      success: true,
      message: `Locker ${maintenance ? "set to maintenance" : "restored to available"}.`,
    });

  } catch (err) {
    console.error("Maintenance toggle error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// Session history — filter সহ
// GET /api/admin/sessions?status=active&date=2024-11-01&limit=50
// ─────────────────────────────────────────────────────────
export const getSessionHistory = async (req, res) => {
  const { status, date, limit = 50 } = req.query;

  try {
    let query = `
      SELECT
        se.id,
        se.claimed_at,
        se.released_at,
        se.status,
        TIMESTAMPDIFF(MINUTE, se.claimed_at, 
          IFNULL(se.released_at, NOW())) AS duration_minutes,
        st.name         AS student_name,
        st.student_code AS student_code,
        st.department   AS department,
        l.locker_number AS locker_number,
        l.location      AS location
      FROM sessions se
      JOIN students st ON st.id = se.student_id
      JOIN lockers  l  ON l.id  = se.locker_id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += " AND se.status = ?";
      params.push(status);
    }

    if (date) {
      query += " AND DATE(se.claimed_at) = ?";
      params.push(date);
    }

    query += ` ORDER BY se.claimed_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const [sessions] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: sessions.length,
      sessions,
    });

  } catch (err) {
    console.error("Session history error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// সব student list
// GET /api/admin/students?active=true
// ─────────────────────────────────────────────────────────
export const getAllStudents = async (req, res) => {
  const { active } = req.query;

  try {
    let query = `
      SELECT
        id, student_code, name, email, phone,
        is_active, created_at
      FROM students
      WHERE 1=1
    `;

    const params = [];

    if (active !== undefined) {
      query += " AND is_active = ?";
      params.push(active === "true" ? 1 : 0);
    }

    query += " ORDER BY created_at DESC";

    const [students] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: students.length,
      students,
    });

  } catch (err) {
    console.error("Get students error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// Student active/inactive করো
// PATCH /api/admin/students/:id/status
// Body: { is_active: true | false }
// ─────────────────────────────────────────────────────────
export const toggleStudentStatus = async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "is_active field must be true or false.",
    });
  }

  try {
    await pool.query(
      "UPDATE students SET is_active = ? WHERE id = ?",
      [is_active, id]
    );

    return res.status(200).json({
      success: true,
      message: `Student ${is_active ? "activated" : "deactivated"} successfully.`,
    });

  } catch (err) {
    console.error("Toggle student status error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};