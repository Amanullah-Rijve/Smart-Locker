import cron from "node-cron";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();

// ─────────────────────────────────────────────────────────
// JOB 1: Session auto-expire
// প্রতি ৫ মিনিটে চলবে
// 3 ঘণ্টার বেশি active session গুলো expire করবে
// ─────────────────────────────────────────────────────────
export function startSessionExpiryJob() {
  cron.schedule("*/5 * * * *", async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 3 ঘণ্টার বেশি active session খোঁজো
      const [expiredSessions] = await conn.query(
        `SELECT s.id, s.locker_id
         FROM sessions s
         WHERE s.status = 'active'
         AND TIMESTAMPDIFF(HOUR, s.claimed_at, NOW()) >= ?`,
        [process.env.SESSION_TIMEOUT_HOURS]
      );

      if (expiredSessions.length > 0) {
        // Session গুলো expired করো
        const sessionIds = expiredSessions.map(s => s.id);
        const lockerIds  = expiredSessions.map(s => s.locker_id);

        await conn.query(
          `UPDATE sessions 
           SET status = 'expired', released_at = NOW()
           WHERE id IN (?)`,
          [sessionIds]
        );

        // Locker গুলো available করো
        await conn.query(
          `UPDATE lockers 
           SET status = 'available'
           WHERE id IN (?)`,
          [lockerIds]
        );

        await conn.commit();
        console.log(`⏰ Auto-expired ${expiredSessions.length} session(s).`);
      } else {
        await conn.rollback();
      }

    } catch (err) {
      await conn.rollback();
      console.error("Session expiry job error:", err.message);
    } finally {
      conn.release();
    }
  });

  console.log("✅ Session expiry job started — runs every 5 minutes.");
}

// ─────────────────────────────────────────────────────────
// JOB 2: রাত ৮টায় hard reset
// প্রতিদিন রাত ৮:০০ PM BD time এ সব locker force release
// ─────────────────────────────────────────────────────────
export function startNightlyResetJob() {
  // Bangladesh time = UTC+6
  // রাত ৮টা BD = দুপুর ২টা UTC = 14:00 UTC
  // cron এ UTC time দিতে হবে
  const resetHour = parseInt(process.env.AUTO_UNLOCK_HOUR) - 6; // 20 - 6 = 14

  cron.schedule(`0 ${resetHour} * * *`, async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // সব active session খোঁজো
      const [activeSessions] = await conn.query(
        `SELECT s.id, s.locker_id
         FROM sessions s
         WHERE s.status = 'active'`
      );

      if (activeSessions.length > 0) {
        const sessionIds = activeSessions.map(s => s.id);
        const lockerIds  = activeSessions.map(s => s.locker_id);

        // সব session expired করো
        await conn.query(
          `UPDATE sessions 
           SET status = 'expired', released_at = NOW()
           WHERE id IN (?)`,
          [sessionIds]
        );

        // সব locker available করো
        await conn.query(
          `UPDATE lockers 
           SET status = 'available'
           WHERE id IN (?)`,
          [lockerIds]
        );

        await conn.commit();
        console.log(`🌙 Nightly reset: ${activeSessions.length} locker(s) released.`);
      } else {
        await conn.rollback();
        console.log("🌙 Nightly reset: No active sessions to clear.");
      }

    } catch (err) {
      await conn.rollback();
      console.error("Nightly reset job error:", err.message);
    } finally {
      conn.release();
    }
  });

  console.log(`✅ Nightly reset job started — runs at 8:00 PM BD time.`);
}