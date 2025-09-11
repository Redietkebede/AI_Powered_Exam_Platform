import type {} from "./types/express";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pool from "./config/db";

import protectedRoutes from "./routes/protectedRoutes";
import morgan from "morgan";
import examsRoutes from './routes/examRoutes';
import usersRoutes from './routes/usersRoutes';
import questionsRoutes from './routes/questionsRoutes';
import authRoutes from './routes/authRoutes';
import publishRoutes from "./routes/publishRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";

import { ZodError } from "zod";
import { formatZodError } from "./utils/zodError";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? [
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
app.use("/api/auth", authRoutes);
app.get("/api/exams/start"); 
app.use('/api', questionsRoutes);
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof ZodError) {
    const details = formatZodError(err);
    // Log for server visibility
    console.error("[ZOD] validation failed:", JSON.stringify(details, null, 2));
    return res.status(400).json({ error: "Invalid input", ...details });
  }
  // fall through to your default error handler (or create one)
  return next(err);
});

// (optional) default error handler if you don't already have one
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERR]", err);
  res.status(err?.statusCode ?? 500).json({ error: "Internal server error" });
});
app.use("/api/publish", publishRoutes);
app.use("/api", protectedRoutes);
app.use("/api", assignmentRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api', usersRoutes);

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
