import express from 'express';
import cors from "cors";
import dotenv from 'dotenv';
import { connectDB } from "./src/config/db.js";
import authRoutes from "./src/routes/auth.routes.js";
import otpRoutes from "./src/routes/otp.routes.js";
import lockerRoutes from "./src/routes/locker.routes.js";
import adminRoutes from "./src/routes/admin.routes.js";
import { startSessionExpiryJob, startNightlyResetJob } from "./src/jobs/scheduler.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Smart Locker API is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/locker", lockerRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(` Server running at http://localhost:${PORT}`);
    startSessionExpiryJob();
    startNightlyResetJob();
  });
});