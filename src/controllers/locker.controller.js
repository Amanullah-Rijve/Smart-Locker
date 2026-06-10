import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();

// ─────────────────────────────────────────────────────────
// MAIN SCAN ENDPOINT — ESP32 এই endpoint call করবে
// POST /api/locker/scan
// Header: x-device-key
// Body: { card_uid }
// ─────────────────────────────────────────────────────────
export const scanCard = async (req, res) => {
  const { card_uid } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!card_uid) {
    return res.status(400).json({
      success: false,
      message: "card_uid is required.",
    });
  }

  // ── Transaction শুরু ────────────────────────────────────
  // কেন transaction? Claim আর locker update
  // দুটো একসাথে হতে হবে — একটা fail হলে দুটোই cancel
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // ── Step 1: Student আছে কিনা check ──────────────────
    const [students] = await conn.query(
  "SELECT id, name, student_code FROM students WHERE card_uid = ? AND is_active = TRUE",
  [card_uid]
);

    // Student নেই — registration দরকার
    if (!students.length) {

      // Pending এ আছে কিনা check — মানে আগে info দিয়েছে
      // কিন্তু OTP verify করেনি
      const [pending] = await conn.query(
        "SELECT id FROM pending_registrations WHERE card_uid = ?",
        [card_uid]
      );

      await conn.rollback();

      // Frontend এ দেখাবে — registration form
      return res.status(404).json({
        success: false,
        action: "needs_registration",
        hasPending: pending.length > 0,
        message: pending.length > 0
          ? "Please complete your OTP verification to finish registration."
          : "Card not registered. Please register to use the locker system.",
      });
    }

    const student = students[0];

    // ── Step 2: Active session আছে কিনা check ───────────
    const [activeSessions] = await conn.query(
      `SELECT s.id, s.locker_id, s.claimed_at, l.locker_number
       FROM sessions s
       JOIN lockers l ON l.id = s.locker_id
       WHERE s.student_id = ? AND s.status = 'active'`,
      [student.id]
    );

    // ── RELEASE FLOW ─────────────────────────────────────
    if (activeSessions.length > 0) {
      const session = activeSessions[0];

      // Session release করো
      await conn.query(
        `UPDATE sessions 
         SET status = 'released', released_at = NOW() 
         WHERE id = ?`,
        [session.id]
      );

      // Locker available করো
      await conn.query(
        "UPDATE lockers SET status = 'available' WHERE id = ?",
        [session.locker_id]
      );

      await conn.commit();

      // Duration calculate করো
      const claimedAt = new Date(session.claimed_at);
      const now = new Date();
      const diffMs = now - claimedAt;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      return res.status(200).json({
        success: true,
        action: "released",
        lockerNumber: session.locker_number,
        studentName: student.name,
        duration: `${diffMins}m ${diffSecs}s`,
        message: `Locker ${session.locker_number} released. Goodbye, ${student.name}!`,
      });
    }

    // ── CLAIM FLOW ────────────────────────────────────────
    // Free locker খোঁজো
    const [freeLockers] = await conn.query(
      `SELECT id, locker_number, location 
       FROM lockers
       WHERE status = 'available'
       ORDER BY CAST(locker_number AS UNSIGNED)
       LIMIT 1`
    );

    // কোনো locker নেই
    if (!freeLockers.length) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        action: "no_locker_available",
        message: "No lockers available at this time. Please try again later.",
      });
    }

    const locker = freeLockers[0];

    // Locker occupied করো
    await conn.query(
      "UPDATE lockers SET status = 'occupied' WHERE id = ?",
      [locker.id]
    );

    // Session তৈরি করো
    await conn.query(
      `INSERT INTO sessions (student_id, locker_id) 
       VALUES (?, ?)`,
      [student.id, locker.id]
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      action: "claimed",
      lockerNumber: locker.locker_number,
      location: locker.location,
      studentName: student.name,
      studentCode: student.student_code,
      expiresIn: `${process.env.SESSION_TIMEOUT_HOURS} hours`,
      message: `Locker ${locker.locker_number} assigned to ${student.name}. Expires in ${process.env.SESSION_TIMEOUT_HOURS} hours.`,
    });

  } catch (err) {
    await conn.rollback();
    console.error("Scan error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  } finally {
    // সবসময় connection release করো
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// সব locker এর current status
// GET /api/locker/status
// Public — student UI তে দেখাবে
// ─────────────────────────────────────────────────────────
export const getAllLockerStatus = async (req, res) => {
  try {
    const [lockers] = await pool.query(
      `SELECT
         l.id,
         l.locker_number,
         l.location,
         l.status,
         st.name         AS student_name,
         st.student_code AS student_code,
         se.claimed_at,
         -- কতক্ষণ হলো minutes এ
         TIMESTAMPDIFF(MINUTE, se.claimed_at, NOW()) AS minutes_used,
         -- কতক্ষণ বাকি আছে
         (${process.env.SESSION_TIMEOUT_HOURS} * 60) - 
         TIMESTAMPDIFF(MINUTE, se.claimed_at, NOW()) AS minutes_remaining
       FROM lockers l
       LEFT JOIN sessions se 
         ON se.locker_id = l.id AND se.status = 'active'
       LEFT JOIN students st 
         ON st.id = se.student_id
       ORDER BY CAST(l.locker_number AS UNSIGNED)`
    );

    // Summary বানাও
    const summary = {
      total:       lockers.length,
      available:   lockers.filter(l => l.status === "available").length,
      occupied:    lockers.filter(l => l.status === "occupied").length,
      maintenance: lockers.filter(l => l.status === "maintenance").length,
    };

    return res.status(200).json({
      success: true,
      summary,
      lockers,
    });

  } catch (err) {
    console.error("Locker status error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// একটা নির্দিষ্ট locker এর detail
// GET /api/locker/:lockerNumber
// Public
// ─────────────────────────────────────────────────────────
export const getLockerDetail = async (req, res) => {
  const { lockerNumber } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT
         l.id,
         l.locker_number,
         l.location,
         l.status,
         st.name         AS student_name,
         st.student_code AS student_code,
         se.claimed_at,
         TIMESTAMPDIFF(MINUTE, se.claimed_at, NOW()) AS minutes_used
       FROM lockers l
       LEFT JOIN sessions se 
         ON se.locker_id = l.id AND se.status = 'active'
       LEFT JOIN students st 
         ON st.id = se.student_id
       WHERE l.locker_number = ?`,
      [lockerNumber]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: `Locker ${lockerNumber} not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      locker: rows[0],
    });

  } catch (err) {
    console.error("Locker detail error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};