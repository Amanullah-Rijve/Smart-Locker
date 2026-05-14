import express, { response } from 'express';
import cors from 'cros';
import dotenv from 'dotenv';
import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// health check
app.get("/health",(req,res)=>{
    res.json({
    success: true,
    message: "Smart Locker API is running",
    timestamp: new Date().toISOString(),
    });
})

// Routes
app.use("/api/auth",authRoutes);

// 404 handel
app.use((req,res)=>{
    res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    })
})

// start server 
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(` Server running at http://localhost:${PORT}`);
  });
});


