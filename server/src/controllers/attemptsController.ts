import type { RequestHandler } from "express";
import pool from "../config/db";

const normalizeDifficulty = (d: any) => (d ?? "").toString().trim() || "Medium";

/** GET /attempts/mine */
export const listMyAttempts: RequestHandler = async (req, res) => {
  const userId = req.user!.id; // already set by requireAuth
  const sql = `
    SELECT a.id,
           a.created_at,
           COALESCE(COUNT(ans.*),0)                 AS answered,
           COALESCE(SUM(CASE WHEN ans.is_correct THEN 1 ELSE 0 END),0) AS correct,
           COALESCE(ROUND(AVG(ans.score)::numeric,2),0)                 AS avg_score
    FROM attempts a
    LEFT JOIN answers ans ON ans.attempt_id = a.id
    WHERE a.user_id = $1
    GROUP BY a.id
    ORDER BY a.created_at DESC
    LIMIT 100;
  `;
  const { rows } = await pool.query(sql, [userId]);
  res.json(rows);
};

const difficultyLabelSql = `
  CASE a.question_difficulty
    WHEN 1 THEN 'Very Easy'
    WHEN 2 THEN 'Easy'
    WHEN 3 THEN 'Medium'
    WHEN 4 THEN 'Hard'
    WHEN 5 THEN 'Very Hard'
    ELSE 'Medium'
  END
`;

export const attemptSummary: RequestHandler = async (req, res, next) => {
  try {
    // NOTE: attemptId in the route == session_id in DB
    const sessionId = Number(req.params.attemptId ?? req.params.id);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: "Invalid attemptId" });
    }

    // Totals directly from answers using snake_case
    const totals = await pool.query(
      `
  WITH t AS (
    SELECT
      es.total_questions::int AS total_questions
    FROM exam_sessions es
    WHERE es.id = $1
    LIMIT 1
  ),
  c AS (
    SELECT
      COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0)::int AS correct_questions
    FROM answers a
    WHERE a.session_id = $1
  )
  SELECT t.total_questions, c.correct_questions
  FROM t CROSS JOIN c
  `,
      [sessionId]
    );

    // Accuracy by numeric difficulty -> label in SQL (no casting to int!)
    const byDiff = await pool.query(
      `
      SELECT
        ${difficultyLabelSql}                                                     AS difficulty,
        ROUND(
          100.0 * SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          1
        )                                                                         AS accuracy_pct
      FROM answers a
      WHERE a.session_id = $1
      GROUP BY ${difficultyLabelSql}
      ORDER BY 1
      `,
      [sessionId]
    );

    // Running-accuracy sequence for chart (ordered)
    const seq = await pool.query<{ is_correct: boolean }>(
      `
      SELECT is_correct
      FROM answers
      WHERE session_id = $1
      ORDER BY id ASC
      `,
      [sessionId]
    );

    const total = Number(totals.rows?.[0]?.total_questions ?? 0);
    const correct = Number(totals.rows?.[0]?.correct_questions ?? 0);
    const accuracy_pct = total > 0 ? Math.round((100 * correct) / total) : 0;

    return res.json({
      total_questions: total,
      correct_questions: correct,
      average_score: accuracy_pct,
      accuracy_pct,
      byDifficulty: byDiff.rows ?? [],
      sequence: (seq.rows ?? []).map((r) => !!r.is_correct),
    });
  } catch (err) {
    return next(err);
  }
};
/**
 * GET /attempts/:attemptId/items
 * Returns per-question rows for the table & topic stats:
 * [{ questionId, correct, topic, difficulty, timeSpentMs }]
 */
export const getAttemptItems: RequestHandler = async (req, res, next) => {
  try {
    const sessionId = Number(req.params.attemptId ?? req.params.id);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: "Invalid attemptId" });
    }

    // Difficulty label mapping driven by questions.difficulty
    const difficultyLabelFromQuestions = `
      CASE q.difficulty
        WHEN 1 THEN 'Very Easy'
        WHEN 2 THEN 'Easy'
        WHEN 3 THEN 'Medium'
        WHEN 4 THEN 'Hard'
        WHEN 5 THEN 'Very Hard'
        ELSE 'Medium'
      END
    `;
    const rows = await pool.query(
      `
  SELECT
    a.question_id                           AS "questionId",
    a.is_correct                            AS "correct",
    COALESCE(q.topic, '-')                  AS "topic",
    CASE q.difficulty
      WHEN 1 THEN 'Very Easy'
      WHEN 2 THEN 'Easy'
      WHEN 3 THEN 'Medium'
      WHEN 4 THEN 'Hard'
      WHEN 5 THEN 'Very Hard'
      ELSE 'Medium'
    END                                     AS "difficulty",
    (COALESCE(a.time_taken_seconds, a.time_taken_sec, 0) * 1000)::int AS "timeSpentMs"
  FROM answers a
  LEFT JOIN questions q ON q.id = a.question_id
  WHERE a.session_id = $1
  ORDER BY a.id ASC
  `,
      [sessionId]
    );

    return res.json(rows.rows);
  } catch (err) {
    return next(err);
  }
};
