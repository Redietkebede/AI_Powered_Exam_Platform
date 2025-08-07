import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pool from "./config/db";

import { verifyToken } from "./middleware/auth";
import { AuthRequest } from "./types/AuthRequest";
import protectedRoutes from "./routes/protectedRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Test route
app.get("/", (_req, res) => res.send("API is working!"));

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err: any) {
    console.error("DB test failed:", err.message);
    res.status(500).json({ connected: false, error: err.message });
  }
});

app.get('/api/exams/start', verifyToken, (req: AuthRequest, res) => {
  const userId = req.user?.uid;
  res.send(`User ${userId} started the exam.`);
});

app.use('/api', protectedRoutes);


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
