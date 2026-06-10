import nodemailer from "nodemailer";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();

// ─── Email transporter ────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// ─── Helper: OTP generate ─────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Helper: OTP email পাঠাও ─────────────────────────────
async function sendRegistrationOTP(email, otp, name) {
  await transporter.sendMail({
    from: `"Smart Locker System" <${process.env.MAIL_USER}>`,
    to: email,
    subject: "Smart Locker — Verify Your Registration",
    html: `
      <h2>Hello, ${name}!</h2>
      <p>You have requested to register for the Smart Locker System.</p>
      <p>Your verification OTP:</p>
      <h1 style="letter-spacing: 6px; color: #1d6ef5;">${otp}</h1>
      <p>This OTP will expire in <strong>${process.env.OTP_EXPIRES_IN} minutes</strong>.</p>
      <p>If you did not request this, ignore this email.</p>
    `,
  });
}

// ─────────────────────────────────────────────────────────
// STEP 1: Student info নাও → pending table এ save → OTP পাঠাও
// POST /api/otp/register
// Body: { card_uid, name, student_code, email, phone }
// ─────────────────────────────────────────────────────────
export const registerStudent = async (req, res) => {
  const { card_uid, name, student_code, email, phone } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!card_uid || !name || !student_code || !email || !phone) {
    return res.status(400).json({
      success: false,
      message: "All fields are required: card_uid, name, student_code, email, phone.",
    });
  }

  // ── Daffodil email check ────────────────────────────────
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (!email.endsWith(`@${allowedDomain}`)) {
    return res.status(403).json({
      success: false,
      message: `Only @${allowedDomain} email addresses are allowed.`,
    });
  }

  try {
    // ── Already registered কিনা check ───────────────────
    const [existing] = await pool.query(
      "SELECT id FROM students WHERE card_uid = ? OR email = ? OR student_code = ?",
      [card_uid, email, student_code]
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Student already registered with this card, email, or student ID.",
      });
    }

    // ── Pending এ already আছে কিনা check ────────────────
    const [pending] = await pool.query(
      "SELECT id FROM pending_registrations WHERE card_uid = ?",
      [card_uid]
    );

    if (pending.length) {
      await pool.query(
        "UPDATE pending_registrations SET name = ?, student_code = ?, email = ?, phone = ? WHERE card_uid = ?",
        [name, student_code, email, phone, card_uid]
      );
    } else {
      await pool.query(
        "INSERT INTO pending_registrations (card_uid, name, student_code, email, phone) VALUES (?, ?, ?, ?, ?)",
        [card_uid, name, student_code, email, phone]
      );
    }

    // ── আগের OTP delete করো ─────────────────────────────
    await pool.query(
      "DELETE FROM otp_verifications WHERE email = ? AND purpose = 'registration'",
      [email]
    );

    // ── নতুন OTP বানাও ───────────────────────────────────
    const otp = generateOTP();
    const expiresAt = new Date(
      Date.now() + process.env.OTP_EXPIRES_IN * 60 * 1000
    );

    // ── OTP save করো ─────────────────────────────────────
    await pool.query(
      "INSERT INTO otp_verifications (email, otp_code, purpose, expires_at) VALUES (?, ?, 'registration', ?)",
      [email, otp, expiresAt]
    );

    // ── Email পাঠাও — fail হলেও registration থামবে না ───
    try {
      await sendRegistrationOTP(email, otp, name);
    } catch (mailErr) {
      console.error("Mail error (non-critical):", mailErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `OTP sent to ${email}. Please verify to complete registration.`,
    });

  } catch (err) {
    console.error("Registration error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ─────────────────────────────────────────────────────────
// STEP 2: OTP verify → pending থেকে students এ move করো
// POST /api/otp/verify-registration
// Body: { email, otp }
// ─────────────────────────────────────────────────────────
export const verifyRegistration = async (req, res) => {
  const { email, otp } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required.",
    });
  }

  try {
    // ── OTP খোঁজো ────────────────────────────────────────
    const [otpRows] = await pool.query(
      "SELECT * FROM otp_verifications WHERE email = ? AND purpose = 'registration' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1",
      [email]
    );

    if (!otpRows.length) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please register again.",
      });
    }

    const otpRecord = otpRows[0];

    // ── Expire check ──────────────────────────────────────
    if (new Date() > new Date(otpRecord.expires_at)) {
      await pool.query(
        "DELETE FROM otp_verifications WHERE id = ?",
        [otpRecord.id]
      );
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please register again.",
      });
    }

    // ── OTP match check ───────────────────────────────────
    if (otpRecord.otp_code !== otp) {
      return res.status(400).json({
        success: false,
        message: "Incorrect OTP. Please try again.",
      });
    }

    // ── Pending registration খোঁজো ───────────────────────
    const [pendingRows] = await pool.query(
      "SELECT * FROM pending_registrations WHERE email = ?",
      [email]
    );

    if (!pendingRows.length) {
      return res.status(400).json({
        success: false,
        message: "Registration data not found. Please start over.",
      });
    }

    const pending = pendingRows[0];

    // ── Transaction — pending → students ─────────────────
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        "INSERT INTO students (card_uid, student_code, name, email, phone) VALUES (?, ?, ?, ?, ?)",
        [pending.card_uid, pending.student_code, pending.name, pending.email, pending.phone]
      );

      await conn.query(
        "DELETE FROM pending_registrations WHERE id = ?",
        [pending.id]
      );

      await conn.query(
        "UPDATE otp_verifications SET is_used = TRUE WHERE id = ?",
        [otpRecord.id]
      );

      await conn.commit();

      return res.status(201).json({
        success: true,
        message: `Registration successful! Welcome, ${pending.name}. You can now use the locker system.`,
      });

    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

  } catch (err) {
    console.error("Verify registration error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};