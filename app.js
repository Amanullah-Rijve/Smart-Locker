import express from 'express';
import cors from "cors";
import dotenv from 'dotenv';
import { connectDB } from "./src/config/db.js";
import authRoutes from "./src/routes/auth.routes.js";
import otpRoutes from "./src/routes/otp.routes.js";

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Smart Locker API is running",
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Start server
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
});