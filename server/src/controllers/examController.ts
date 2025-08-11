import { Response } from "express";
import pool from "../config/db";
import { adaptiveEngine } from "../services/adaptive"; // bayesian engine
import { updateElo } from "../services/elo";
import { ensureUser } from "../controllers/meControllers";
import { AuthRequest } from "../types/AuthRequest";

export async function startExam(req: AuthRequest, res: Response) {
  try {
    // Auth guard
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Body & guard rails
    const { testId, examId } = (req.body || {}) as { testId?: number; examId?: number };
    const inputTestId = testId ?? examId;
    if (!inputTestId) {
      return res.status(400).json({ error: "Missing required testId" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) Validate test exists
      const t = await client.query(`SELECT id FROM tests WHERE id = $1`, [inputTestId]);
      if (!t.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: `Test not found (id=${inputTestId})` });
      }

      // 2) Validate test has linked questions
      const qcount = await client.query(
        `SELECT COUNT(*)::int AS c FROM test_questions WHERE test_id = $1`,
        [inputTestId]
      );
      if (qcount.rows[0].c === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Test ${inputTestId} has no questions` });
      }

      // 3) Create session with total_questions
      const s = await client.query(
        `WITH tq AS (
           SELECT COUNT(*)::int AS cnt FROM test_questions WHERE test_id = $1
         )
         INSERT INTO exam_sessions (user_id, test_id, started_at, total_questions)
         SELECT $2, $1, NOW(), tq.cnt FROM tq
         RETURNING id, total_questions`,
        [inputTestId, userId]
      );
      const sessionId = s.rows[0].id as number;
      const totalQuestions = s.rows[0].total_questions as number;

      // 4) Snapshot questions → session_questions
      await client.query(
        `INSERT INTO session_questions (session_id, question_id, position)
         SELECT $1, question_id, position
         FROM test_questions
         WHERE test_id = $2
         ORDER BY position`,
        [sessionId, inputTestId]
      );

      await client.query("COMMIT");
      return res.status(201).json({ sessionId, testId: inputTestId, totalQuestions });
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error("startExam tx error:", err);
      return res.status(500).json({ error: "Server error" });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("startExam error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

export async function getNextQuestion(req: AuthRequest, res: Response) {
  const uid = req.user!.uid;
  const { sessionId } = req.body as { sessionId: number };

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    // 1) Ensure session belongs to user
    const { rows: srows } = await pool.query(
      `
      SELECT s.id, s.test_id, u.id AS user_id
      FROM exam_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.firebase_uid = $2
      `,
      [sessionId, uid]
    );
    if (srows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // 2) Past answers for adaptive history
    const { rows: arows } = await pool.query(
      `
      SELECT is_correct AS "correct", question_difficulty AS "difficulty"
      FROM answers
      WHERE session_id = $1
      ORDER BY id ASC
      `,
      [sessionId]
    );
    const history = arows as { correct: boolean; difficulty: number }[];

    // 3) Decide next difficulty (1..5)
    const targetDifficulty = adaptiveEngine.getNextDifficulty({ history });

    // 4) Pick an unseen question that matches difficulty
    const { rows: qrows } = await pool.query(
      `
      SELECT
        q.id,
        q.question_text  AS stem,
        q.options        AS choices,
        q.correct_answer AS correct,
        q.difficulty
      FROM questions q
      WHERE q.difficulty = $1
        AND NOT EXISTS (
          SELECT 1
          FROM answers a
          WHERE a.session_id = $2
            AND a.question_id = q.id
        )
      LIMIT 1
      `,
      [targetDifficulty, sessionId]
    );

    if (qrows.length === 0) {
      return res.status(404).json({ error: "No question available" });
    }

    const q = qrows[0];
    return res.json({
      question: {
        id: q.id,
        stem: q.stem,
        choices: q.choices, // JSONB {A,B,C,D}
        difficulty: q.difficulty,
      },
    });
  } catch (e: any) {
    console.error("getNextQuestion error:", e);
    return res.status(500).json({ error: e.message });
  }
}

export async function submitAnswer(req: AuthRequest, res: Response) {
  const uid = req.user!.uid;
  const { sessionId, questionId, selected, timeTakenSeconds } = req.body;

  try {
    // Get correct answer & difficulty
    const { rows: qrows } = await pool.query(
      `SELECT correct, difficulty FROM questions WHERE id = $1`,
      [questionId]
    );
    if (qrows.length === 0)
      return res.status(404).json({ error: "Question not found" });

    const isCorrect = qrows[0].correct === selected;
    const difficulty = qrows[0].difficulty;

    // Store answer
    await pool.query(
      `INSERT INTO answers (session_id, question_id, selected, is_correct, time_taken_seconds, question_difficulty)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        sessionId,
        questionId,
        selected,
        isCorrect,
        timeTakenSeconds ?? null,
        difficulty,
      ]
    );

    // (Optional) update Elo rating live per answer
    const { rows: srows } = await pool.query(
      `SELECT s.test_id, u.id as user_id
         FROM exam_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`,
      [sessionId]
    );
    const { exam_id: testId, user_id: userId } = srows[0];

    const { rows: rrows } = await pool.query(
      `INSERT INTO ratings (user_id, exam_id, rating)
       VALUES ($1,$2,1200)
       ON CONFLICT (user_id, exam_id) DO UPDATE SET rating = ratings.rating
       RETURNING rating`,
      [userId, testId]
    );
    const current = rrows[0].rating;
    const next = updateElo(current, difficulty, isCorrect);
    await pool.query(
      `UPDATE ratings SET rating = $1 WHERE user_id = $2 AND exam_id = $3`,
      [next, userId, testId]
    );

    res.json({ correct: isCorrect, newRating: next });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function submitExam(req: AuthRequest, res: Response) {
  const uid = req.user!.uid;
  const { sessionId } = req.body as { sessionId: number };

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    // 1) Ensure session belongs to user
    const { rows: srows } = await pool.query(
      `
      SELECT s.id
      FROM exam_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.firebase_uid = $2
      `,
      [sessionId, uid]
    );
    if (srows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // 2) Mark submitted
    await pool.query(
      `UPDATE exam_sessions SET submitted_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    if (srows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // 2) Mark submitted
    await pool.query(
      `UPDATE exam_sessions SET submitted_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    // 3) Compute summary
    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE is_correct) AS correct,
        COUNT(*)                             AS total
      FROM answers
      WHERE session_id = $1
      `,
      [sessionId]
    );

    const correct = Number(rows[0]?.correct ?? 0);
    const total = Number(rows[0]?.total ?? 0);
    const accuracy = total ? correct / total : 0;

    return res.json({ sessionId, correct, total, accuracy });
  } catch (e: any) {
    console.error("submitExam error:", e);
    return res.status(500).json({ error: e.message });
  }
}
