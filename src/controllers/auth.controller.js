import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

// ─── OTP email পাঠাও ─────────────────────────────────────
async function sendOTPEmail(email, otp, name) {
    await transporter.sendMail({
    from: `"Smart Locker System" <${process.env.MAIL_USER}>`,
    to: email,
    subject: "Smart Locker — Admin Login OTP",
    html: `
        <h2>Hello, ${name}</h2>
        <p>Your OTP for Smart Locker admin login:</p>
        <h1 style="letter-spacing: 6px; color: #1d6ef5;">${otp}</h1>
        <p>This OTP will expire in <strong>${process.env.OTP_EXPIRES_IN} minutes</strong>.</p>
        <p>If you did not request this, ignore this email.</p>
    `,
    });
}

// ─── OTP generate ─────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────────────────────
// STEP 1: email + password check → OTP পাঠাও
// POST /api/auth/login
// Body: { email, password }
// ─────────────────────────────────────────────────────────
export const adminLogin = async (req, res) => {
    const { email, password } = req.body;

  // ── Validation ──────────────────────────────────────────
    if (!email || !password) {
    return res.status(400).json({
        success: false,
        message: "Email and password are required.",
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
    // ── Admin আছে কিনা check ─────────────────────────────
    const [admins] = await pool.query(
      "SELECT * FROM admins WHERE email = ?",
        [email]
    );

    if (!admins.length) {
        return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
        });
    }

    const admin = admins[0];

    // ── Password match করে কিনা check ───────────────────
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
        return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
        });
    }

    // ── আগের unused OTP delete করো ──────────────────────
    await pool.query(
        `DELETE FROM otp_verifications 
        WHERE email = ? AND purpose = 'admin_login'`,
        [email]
    );

    // ── নতুন OTP generate করো ───────────────────────────
    const otp = generateOTP();
    const expiresAt = new Date(
      Date.now() + process.env.OTP_EXPIRES_IN * 60 * 1000
    );

    // ── OTP database এ save করো ──────────────────────────
    await pool.query(
        `INSERT INTO otp_verifications 
        (email, otp_code, purpose, expires_at) 
        VALUES (?, ?, 'admin_login', ?)`,
        [email, otp, expiresAt]
    );

    // ── Email পাঠাও ──────────────────────────────────────
    await sendOTPEmail(email, otp, admin.name);

    return res.status(200).json({
        success: true,
        message: `OTP sent to ${email}. Valid for ${process.env.OTP_EXPIRES_IN} minutes.`,
    });

    } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({
        success: false,
        message: "Internal server error.",
    });
    }
};

// ─────────────────────────────────────────────────────────
// STEP 2: OTP verify → JWT দাও
// POST /api/auth/verify-otp
// Body: { email, otp }
// ─────────────────────────────────────────────────────────
export const verifyAdminOTP = async (req, res) => {
    const { email, otp } = req.body;

  // ── Validation ──────────────────────────────────────────
    if (!email || !otp) {
    return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
    });
    }

    try {
    // ── Database থেকে OTP খোঁজো ─────────────────────────
    const [otpRows] = await pool.query(
      `SELECT * FROM otp_verifications 
        WHERE email = ? 
        AND purpose = 'admin_login' 
        AND is_used = FALSE
        ORDER BY created_at DESC 
        LIMIT 1`,
        [email]
    );

    if (!otpRows.length) {
        return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new one.",
        });
    }

    const otpRecord = otpRows[0];

    // ── Expire হয়েছে কিনা check ─────────────────────────
    if (new Date() > new Date(otpRecord.expires_at)) {
        await pool.query(
        "DELETE FROM otp_verifications WHERE id = ?",
        [otpRecord.id]
        );
        return res.status(400).json({
        success: false,
        message: "OTP has expired. Please login again.",
        });
    }

    // ── OTP সঠিক কিনা check ──────────────────────────────
    if (otpRecord.otp_code !== otp) {
        return res.status(400).json({
        success: false,
        message: "Incorrect OTP. Please try again.",
        });
    }

    // ── OTP used mark করো ────────────────────────────────
    await pool.query(
        "UPDATE otp_verifications SET is_used = TRUE WHERE id = ?",
        [otpRecord.id]
    );

    // ── Admin info নাও ────────────────────────────────────
    const [admins] = await pool.query(
        "SELECT id, name, email FROM admins WHERE email = ?",
        [email]
    );
    const admin = admins[0];

    // ── JWT token তৈরি করো ───────────────────────────────
    const token = jwt.sign(
        { id: admin.id, name: admin.name, email: admin.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.status(200).json({
        success: true,
        message: "Login successful.",
        token,
        admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        },
    });

    } catch (err) {
    console.error("OTP verify error:", err.message);
    return res.status(500).json({
        success: false,
        message: "Internal server error.",
    });
    }
};

// ─────────────────────────────────────────────────────────
// Admin profile update
// PATCH /api/auth/update-profile
// Body: { name?, currentPassword?, newPassword? }
// ─────────────────────────────────────────────────────────
export const updateAdminProfile = async (req, res) => {
    const adminId = req.admin.id;
    const { name, currentPassword, newPassword } = req.body;

    if (!name && !newPassword) {
    return res.status(400).json({
        success: false,
        message: "Nothing to update.",
    });
    }

    try {
    const [admins] = await pool.query(
      "SELECT * FROM admins WHERE id = ?",
        [adminId]
    );
    const admin = admins[0];

    // ── Name update ───────────────────────────────────────
    if (name) {
        await pool.query(
        "UPDATE admins SET name = ? WHERE id = ?",
        [name, adminId]
        );
    }

    // ── Password update ───────────────────────────────────
    if (newPassword) {
        if (!currentPassword) {
        return res.status(400).json({
            success: false,
            message: "Current password is required to set a new password.",
        });
        }

        const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!isMatch) {
        return res.status(401).json({
            success: false,
            message: "Current password is incorrect.",
        })  ;
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query(
        "UPDATE admins SET password_hash = ? WHERE id = ?",
        [hash, adminId]
        );
    }

    return res.status(200).json({
        success: true,
        message: "Profile updated successfully.",
    });

    } catch (err) {
    console.error("Profile update error:", err.message);
    return res.status(500).json({
        success: false,
        message: "Internal server error.",
    });
    }
};