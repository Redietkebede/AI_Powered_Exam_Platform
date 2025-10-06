import type { RequestHandler } from "express";
import pool from "../config/db";
import { z } from "zod";

export const getSessionTopic: RequestHandler = async (req, res) => {
  const Params = z.object({ id: z.string().regex(/^\d+$/) });
  const parsed = Params.safeParse(req.params);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid session id" });
  const sessionId = Number(parsed.data.id);

  // ownership check
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) return res.status(401).json({ error: "Unauthenticated" });

  const sess = await pool.query<{ user_id: number }>(
    "SELECT user_id FROM exam_sessions WHERE id = $1",
    [sessionId]
  );
  if (sess.rowCount === 0)
    return res.status(404).json({ error: "Session not found" });
  if (sess.rows[0].user_id !== userId)
    return res.status(403).json({ error: "Forbidden" });

  // first question’s topic
  const q = await pool.query<{ topic: string }>(
    `
      SELECT q.topic
      FROM session_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.session_id = $1
      ORDER BY sq.position ASC
      LIMIT 1
    `,
    [sessionId]
  );

  return res.json({ sessionId, topic: q.rows[0]?.topic ?? null });
};

export const submitSessionAnswers: RequestHandler = async (req, res) => {
  try {
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });

    const userId = Number(rawUserId);
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(userId) || !Number.isInteger(sessionId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    // Owns the session?
    const own = await pool.query(
      "SELECT 1 FROM exam_sessions WHERE id = $1 AND user_id = $2",
      [sessionId, userId]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "Forbidden" });

    // Expect body.answers = [{questionId, selectedIndex, timeTakenSeconds}]
    const answers: Array<{
      questionId: number;
      selectedIndex: number;
      timeTakenSeconds: number;
    }> = Array.isArray(req.body?.answers) ? req.body.answers : [];

    if (answers.length === 0) {
      return res.status(400).json({ error: "No answers provided" });
    }

    // Upsert all answers
    const values: any[] = [];
    const chunks: string[] = [];
    answers.forEach((a, i) => {
      const o = i * 4;
      values.push(
        sessionId,
        Number(a.questionId),
        Number(a.selectedIndex),
        Number(a.timeTakenSeconds || 0)
      );
      chunks.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`);
    });

    await pool.query(
      `
      INSERT INTO session_answers (session_id, question_id, selected_index, time_taken_seconds)
      VALUES ${chunks.join(",")}
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET
        selected_index = EXCLUDED.selected_index,
        time_taken_seconds = EXCLUDED.time_taken_seconds
      `,
      values
    );

    // Compute scoring
    const { rows: scoreRows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE sa.selected_index = q.correct_answer) AS correct,
        COUNT(*) AS total
      FROM session_answers sa
      JOIN questions q ON q.id = sa.question_id
      WHERE sa.session_id = $1
      `,
      [sessionId]
    );
    const correct = Number(scoreRows?.[0]?.correct || 0);
    const total = Number(scoreRows?.[0]?.total || 0);
    const incorrect = Math.max(0, total - correct);

    // Mark session complete (optional, but handy)
    await pool.query(
      `
      UPDATE exam_sessions
      SET completed_at = NOW(), score = $2
      WHERE id = $1
      `,
      [sessionId, total > 0 ? Math.round((correct / total) * 100) : 0]
    );

    // Return a summary shape the client already handles
    res.json({
      sessionId,
      total,
      correct,
      incorrect,
      correctAnswers: correct, // client reads correctAnswers ?? correct
    });
  } catch (err: any) {
    console.error("[submitSessionAnswers] FAILED", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getRemaining: RequestHandler = async (req, res) => {
  const sessionId = Number(req.params.id);

  const { rows } = await pool.query(
    `
    SELECT
      s.started_at,
      s.finished_at,
      s.total_time_seconds
    FROM exam_sessions s                -- ✅ ensure it's exam_sessions
    WHERE s.id = $1                     -- ✅ and filtering by session id
    LIMIT 1
    `,
    [sessionId]
  );

  if (!rows[0]) return res.status(404).json({ error: "Session not found" });

  const r = rows[0];
  const startedAt = r.started_at ? new Date(r.started_at) : null;
  const finished = !!r.finished_at;

  let remaining: number | null = null;
  let deadlineAt: string | null = null;

  if (r.total_time_seconds && startedAt) {
    const deadline = new Date(
      startedAt.getTime() + r.total_time_seconds * 1000
    );
    deadlineAt = deadline.toISOString();
    remaining = Math.max(
      0,
      Math.floor((deadline.getTime() - Date.now()) / 1000)
    );
  }

  return res.json({
    remaining,
    deadlineAt,
    finished,
    total: r.total_time_seconds ?? null, // ✅ return total
  });
};
