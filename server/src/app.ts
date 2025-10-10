// server/src/app.ts
import type {} from "./types/express";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import pool from "./config/db";

import protectedRoutes from "./routes/protectedRoutes";
import examsRoutes from "./routes/examRoutes";
import usersRoutes from "./routes/usersRoutes";
import questionsRoutes from "./routes/questionsRoutes";
import authRoutes from "./routes/authRoutes";
import publishRoutes from "./routes/publishRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";
import attemptsRoutes from "./routes/attemptsRoutes";
import analyticsRoutes from "./routes/analyticsRoutes";
import activityRoutes from "./routes/activityRoutes";
import sessionsRoutes from "./routes/sessionsRoutes";

import { ZodError } from "zod";
import { formatZodError } from "./utils/zodError";

dotenv.config();

const app = express();

// CORS: allow comma-separated origins in CORS_ORIGIN
const allowed = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true }));
app.use(morgan("dev"));

// --- health checks ---
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/db-test", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, now: r.rows?.[0]?.now });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
});

// --- IMPORTANT: no `/api` prefix here ---
app.use("/auth", authRoutes);
app.use("/protected", protectedRoutes);
app.use("/exams", examsRoutes);
app.use("/users", usersRoutes);
app.use("/questions", questionsRoutes);
app.use("/assignments", assignmentRoutes);
app.use("/publish", publishRoutes);
app.use("/attempts", attemptsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/activity", activityRoutes);
app.use("/sessions", sessionsRoutes);

// zod handler
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof ZodError) {
    const details = formatZodError(err);
    console.error("[ZOD] validation failed:", JSON.stringify(details, null, 2));
    return res.status(400).json({ error: "Invalid input", ...details });
  }
  return next(err);
});

// default error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERR]", err);
  res.status(err?.statusCode ?? 500).json({ error: "Internal server error" });
});

export default app;
