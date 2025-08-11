import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import pool from "./config/db";

import { verifyToken } from "./middleware/verifyToken";
import { AuthRequest } from "./types/AuthRequest";
import protectedRoutes from "./routes/protectedRoutes";
import morgan from "morgan";
import examsRoutes from './routes/examRoutes';
import meRoutes from './routes/meRoutes';
import questionsRoutes from './routes/questionsRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? [
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true }));
app.use(morgan("dev"));

// Test route
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err: any) {
    console.error("DB test failed:", err.message);
    res.status(500).json({ connected: false, error: err.message });
  }
});
app.get("/api/exams/start", verifyToken, (req: AuthRequest, res) => {
  const firebaseUid = req.user!.firebaseUid;
  res.send(`User ${firebaseUid} started the exam.`);
});


app.use("/api", protectedRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/me', meRoutes);
app.use('/api/questions', questionsRoutes);

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Server error" });
  }
);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
