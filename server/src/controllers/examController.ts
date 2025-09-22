import { RequestHandler } from "express";
import pool from "../config/db";
import { adaptiveEngine } from "../services/adaptive"; // bayesian engine
import { updateElo } from "../services/elo";
import { ensureUser } from "./usersControllers";
import { z } from "zod";

/**
 * GET /api/questions/topics
 * Returns: [{ topic: "rust", available: 12 }, ...]
 */
export const getTopics: RequestHandler = async (req, res) => {
  try {
    const rawType = String(req.query.type ?? "")
      .trim()
      .toLowerCase();
    const filterByType = rawType.length > 0;

    const sql = `
      SELECT
        lower(trim(topic)) AS topic,
        COUNT(*)::int      AS available
      FROM questions
      WHERE topic IS NOT NULL
        AND trim(topic) <> ''
        AND lower(trim(status)) = 'published'
        ${filterByType ? "AND lower(trim(type)) = $1" : ""}
      GROUP BY 1
      HAVING COUNT(*) > 0
      ORDER BY topic
    `;

    const { rows } = await pool.query(sql, filterByType ? [rawType] : []);
    // rows: [{ topic: 'rust', available: 12 }, ...]
    res.json(rows);
  } catch (err) {
    console.error("[getTopics] error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/**
 * GET /api/questions/available?topic=rust&type=MCQ
 * Returns: { topic, type, available }
 */
export const getAvailableCount: RequestHandler = async (req, res) => {
  const topic = String(req.query.topic ?? "").trim();
  const type = String(req.query.type ?? "MCQ").trim();

  if (!topic) return res.status(400).json({ error: "Missing topic" });

  try {
    const q = await pool.query(
      `
      SELECT COUNT(*)::int AS available
      FROM questions
      WHERE status='published'
        AND type = $2
        AND lower(trim(topic)) = lower(trim($1))
      `,
      [topic, type]
    );
    res.json({ topic, type, available: q.rows[0]?.available ?? 0 });
  } catch (err) {
    console.error("[getAvailableCount] error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const AnswerSchema = z.object({
  sessionId: z.number().int().positive(),
  questionId: z.number().int().positive(),
  selectedIndex: z.number().int().min(0).max(3),
  timeTakenSeconds: z.number().int().min(0).optional(), // you’ll wire this later
});

export const startExam: RequestHandler = async (req, res) => {
  console.log("[startExam] body:", req.body);

  /* ───────────── 0) Auth guard ───────────── */
  const rawUserId =
    (req as any)?.user?.id ??
    (req as any)?.user?.uid ??
    (req as any)?.user_id ??
    null;

  if (rawUserId == null) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = Number(rawUserId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  /* ───────────── 1) Read & sanitize input ───────────── */
  const body = (req.body ?? {}) as {
    testId?: number | string;
    examId?: number | string;
    assignmentId?: number | string;
    topics?: string[] | string;
    limit?: number | string;
    durationSeconds?: number | string;
  };

  // Accept multiple client shapes for test id
  const testIdRaw = body.testId ?? body.examId ?? body.assignmentId;
  const inputTestId = Number(testIdRaw);
  if (!Number.isFinite(inputTestId) || inputTestId <= 0) {
    return res.status(400).json({ error: "Missing or invalid testId" });
  }

  // topics can be array or comma-separated string (filter placeholders, normalise to lowercase)
  const topicsArr: string[] = (
    Array.isArray(body.topics)
      ? body.topics
      : String(body.topics ?? "")
          .split(",")
          .map((t) => t.trim())
  )
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length > 0 && t !== "-" && t !== "—")
    .map((t) => t.toLowerCase());

  // total question limit (fallback 10, clamp 1..100)
  const limNum = Number(body.limit);
  const totalLimit =
    Number.isFinite(limNum) && limNum > 0
      ? Math.min(100, Math.floor(limNum))
      : 10;

  // duration; store in exam_sessions.total_time_seconds (nullable)
  const durNum = Number(body.durationSeconds);
  const totalTimeSeconds =
    Number.isFinite(durNum) && durNum > 0
      ? Math.min(24 * 3600, Math.floor(durNum))
      : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* ───────────── 2) Validate test exists ───────────── */
    const t = await client.query<{ id: number }>(
      `SELECT id FROM tests WHERE id = $1`,
      [inputTestId]
    );
    if (t.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: `Test not found (id=${inputTestId})` });
    }

    /* Helper: discover questions schema bits once */
    const cols = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'questions'
        AND column_name  IN ('status','is_published','published_at','published_by','topic')
      `
    );
    const have = new Set(cols.rows.map((r) => r.column_name));

    const publishedWhere = (alias: string): string => {
      if (have.has("status")) {
        return `(
          LOWER(${alias}.status) IN ('published','approved')
          OR ${alias}.status ILIKE 'publish%'
          OR ${alias}.status ILIKE 'approve%'
        )`;
      }
      if (have.has("is_published")) return `${alias}.is_published = TRUE`;
      if (have.has("published_at")) return `${alias}.published_at IS NOT NULL`;
      if (have.has("published_by")) return `${alias}.published_by IS NOT NULL`;
      return "TRUE";
    };

    /* Helper: build a fresh question set (curated first, else auto-pick) */
    const buildQuestionSet = async () => {
      // 3) Curated set from test_questions
      const curated = await client.query<{
        question_id: number;
        position: number;
      }>(
        `SELECT question_id, position
           FROM test_questions
          WHERE test_id = $1
          ORDER BY position ASC`,
        [inputTestId]
      );

      if (curated.rows.length > 0) {
        return curated.rows
          .slice(0, totalLimit) // clamp
          .map((r, i) => ({ question_id: r.question_id, position: i + 1 }));
      }

      // 4) Auto-pick from published if no curated
      if (topicsArr.length > 0 && have.has("topic")) {
        const perTopic = Math.max(1, Math.floor(totalLimit / topicsArr.length));
        const auto = await client.query<{ id: number }>(
          `
          WITH ranked AS (
            SELECT q.id,
                   LOWER(q.topic) AS topic,
                   ROW_NUMBER() OVER (PARTITION BY LOWER(q.topic) ORDER BY RANDOM()) AS rn
            FROM questions q
            WHERE ${publishedWhere("q")}
              AND LOWER(q.topic) = ANY($2)
          ),
          picked AS (
            SELECT id FROM ranked WHERE rn <= $3
          ),
          fill AS (
            SELECT id
            FROM questions q2
            WHERE ${publishedWhere("q2")}
              AND LOWER(q2.topic) = ANY($2)
              AND q2.id NOT IN (SELECT id FROM picked)
            ORDER BY RANDOM()
            LIMIT GREATEST($1 - (SELECT COUNT(*) FROM picked), 0)
          )
          SELECT id FROM picked
          UNION ALL
          SELECT id FROM fill
          LIMIT $1
          `,
          [totalLimit, topicsArr, perTopic]
        );
        return auto.rows.map((r, idx) => ({
          question_id: r.id,
          position: idx + 1,
        }));
      } else {
        const auto = await client.query<{ id: number }>(
          `
          SELECT q.id
          FROM questions q
          WHERE ${publishedWhere("q")}
          ORDER BY RANDOM()
          LIMIT $1
          `,
          [totalLimit]
        );
        return auto.rows.map((r, idx) => ({
          question_id: r.id,
          position: idx + 1,
        }));
      }
    };

    /* ───────────── 2.1) Reuse unfinished session if exists ───────────── */
    const existing = await client.query<{
      id: number;
      total_questions: number | null;
      total_time_seconds: number | null;
    }>(
      `
      SELECT id, total_questions, total_time_seconds
      FROM exam_sessions
      WHERE user_id = $1
        AND test_id = $2
        AND finished_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [userId, inputTestId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      // **Repair step**: ensure the frozen set exists
      const qcount = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM session_questions WHERE session_id = $1`,
        [row.id]
      );
      const hasFrozen = Number(qcount.rows[0]?.cnt ?? "0") > 0;

      if (!hasFrozen) {
        const chosen = await buildQuestionSet();

        if (chosen.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error:
              "No published questions available for the requested criteria",
            details: { topics: topicsArr, limit: totalLimit },
          });
        }

        // Insert frozen set
        const values = chosen
          .map((_, i) => `($1,$${i * 2 + 2},$${i * 2 + 3})`)
          .join(",");
        const params: any[] = [row.id];
        chosen.forEach((c) => params.push(c.question_id, c.position));
        await client.query(
          `INSERT INTO session_questions (session_id, question_id, position)
           VALUES ${values}`,
          params
        );

        // Update total_questions if it was null/incorrect
        await client.query(
          `UPDATE exam_sessions
             SET total_questions = $2
           WHERE id = $1`,
          [row.id, chosen.length]
        );
      }

      await client.query("COMMIT");
      return res.status(200).json({
        sessionId: row.id,
        attemptId: row.id,
        testId: inputTestId,
        totalQuestions: row.total_questions ?? undefined,
        totalTimeSeconds: row.total_time_seconds ?? undefined,
        userId,
        reused: true,
      });
    }

    /* ───────────── 3–4) Build fresh set ───────────── */
    const chosen = await buildQuestionSet();

    if (chosen.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No published questions available for the requested criteria",
        details: { topics: topicsArr, limit: totalLimit },
      });
    }

    /* ───────────── 5) Create the session ───────────── */
    const s = await client.query(
      `INSERT INTO exam_sessions
         (user_id, test_id, started_at, total_questions, total_time_seconds)
       VALUES ($1, $2, NOW(), $3, $4)
       RETURNING id, total_questions, total_time_seconds`,
      [userId, inputTestId, chosen.length, totalTimeSeconds]
    );
    const sessionId: number = s.rows[0].id;
    const totalQuestions: number = s.rows[0].total_questions;
    const storedDuration: number | null = s.rows[0].total_time_seconds ?? null;

    /* ───────────── 6) Freeze the set ───────────── */
    const values = chosen
      .map((_, i) => `($1,$${i * 2 + 2},$${i * 2 + 3})`)
      .join(",");
    const params: any[] = [sessionId];
    chosen.forEach((c) => params.push(c.question_id, c.position));

    await client.query(
      `INSERT INTO session_questions (session_id, question_id, position)
       VALUES ${values}`,
      params
    );

    await client.query("COMMIT");

    return res.status(201).json({
      sessionId,
      attemptId: sessionId, // alias for FE
      testId: inputTestId,
      totalQuestions,
      totalTimeSeconds: storedDuration,
      userId,
      topics: topicsArr.length ? topicsArr : undefined,
      limit: totalLimit,
      curatedUsed: true, // or compute if you want: chosen came from curated or not
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[startExam] error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
};

export const getNextQuestion: RequestHandler = async (req, res) => {
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
        q.question_text  AS question_text,
        q.options        AS options,
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
        question_text: q.question_text,
        options: q.options, // JSONB {A,B,C,D}
        difficulty: q.difficulty,
      },
    });
  } catch (e: any) {
    console.error("getNextQuestion error:", e);
    return res.status(500).json({ error: e.message });
  }
};

export const submitAnswer: RequestHandler = async (req, res) => {
  try {
    // 0) Validate body
    const parse = AnswerSchema.safeParse(req.body);
    if (!parse.success) {
      return res
        .status(400)
        .json({ error: "Invalid body", issues: parse.error.issues });
    }
    const { sessionId, questionId, selectedIndex, timeTakenSeconds } =
      parse.data;

    // 1) Auth & ownership
    const authedUserId = (req as any)?.user?.id as number | undefined;
    if (!authedUserId)
      return res.status(401).json({ error: "Unauthenticated" });

    const sRes = await pool.query(
      `SELECT user_id, finished_at
         FROM exam_sessions
        WHERE id = $1`,
      [sessionId]
    );
    if (sRes.rowCount === 0)
      return res.status(404).json({ error: "Session not found" });
    if (Number(sRes.rows[0].user_id) !== Number(authedUserId))
      return res.status(403).json({ error: "Forbidden" });

    // Optional: block submissions after session finished
    // if (sRes.rows[0].finished_at) {
    //   return res.status(409).json({ error: "Session already finished" });
    // }

    // 2) Ensure the question is in this frozen session snapshot
    const linkRes = await pool.query(
      `SELECT 1
         FROM session_questions
        WHERE session_id = $1 AND question_id = $2
        LIMIT 1`,
      [sessionId, questionId]
    );
    if (linkRes.rowCount === 0) {
      return res
        .status(400)
        .json({ error: "Question does not belong to this session" });
    }

    // 3) Pull question meta
    const qRes = await pool.query(
      `SELECT correct_answer, difficulty, elo_rating, status
         FROM questions
        WHERE id = $1`,
      [questionId]
    );
    if (qRes.rowCount === 0)
      return res.status(404).json({ error: "Question not found" });

    const q = qRes.rows[0];

    // Allow typical published states (some DBs store "approved")
    const status = String(q.status ?? "").toLowerCase();
    const okStatuses = new Set(["published", "approved"]);
    if (!okStatuses.has(status)) {
      return res.status(400).json({ error: "Question not published" });
    }

    // 4) Validate indices and grade
    const correctIndex = Number(q.correct_answer);
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex > 3
    ) {
      return res
        .status(500)
        .json({ error: "Question correct_answer out of bounds" });
    }
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex > 3
    ) {
      return res.status(400).json({ error: "selectedIndex out of bounds" });
    }

    const isCorrect = selectedIndex === correctIndex;

    // Columns in your table: answers(session_id, question_id, selected_option, correct_answer, is_correct, time_taken_seconds, question_difficulty, question_elo)
    // Use UPSERT so re-selecting doesn't crash on duplicates (requires UNIQUE(session_id, question_id)).
    const selChar = String(selectedIndex) as "0" | "1" | "2" | "3";
    const corChar = String(correctIndex) as "0" | "1" | "2" | "3";

    const aRes = await pool.query(
      `INSERT INTO answers
         (session_id, question_id, selected_option, correct_answer, is_correct,
          time_taken_seconds, question_difficulty, question_elo)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7, $8)
       ON CONFLICT (session_id, question_id) DO UPDATE
         SET selected_option     = EXCLUDED.selected_option,
             correct_answer      = EXCLUDED.correct_answer,
             is_correct          = EXCLUDED.is_correct,
             time_taken_seconds  = EXCLUDED.time_taken_seconds,
             question_difficulty = EXCLUDED.question_difficulty,
             question_elo        = EXCLUDED.question_elo
       RETURNING id, is_correct`,
      [
        sessionId,
        questionId,
        selChar,
        corChar,
        isCorrect,
        Number.isFinite(timeTakenSeconds) ? timeTakenSeconds : null,
        q.difficulty ?? null,
        q.elo_rating ?? null,
      ]
    );

    return res.status(201).json({
      id: aRes.rows[0].id,
      isCorrect: aRes.rows[0].is_correct,
    });
  } catch (err: any) {
    console.error("[submitAnswer] FAILED", {
      code: err?.code,
      detail: err?.detail,
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "submitAnswer",
      code: err?.code ?? null,
      detail: err?.detail ?? err?.message ?? null,
    });
  }
};

// helper to turn 0..3 into 'A'..'D' only if your answers table is char(1)
const toLetter = (idx: number) => ["A", "B", "C", "D"][idx] ?? "A";

export const submitExam: RequestHandler = async (req, res) => {
  const userId = Number((req as any)?.user?.id);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId, answers } = (req.body ?? {}) as {
    sessionId?: number;
    answers?: Array<{
      questionId: number;
      selectedIndex: number;
      timeTakenSeconds?: number;
    }>;
  };

  // basic shape validation
  if (
    !Number.isInteger(sessionId) ||
    !Array.isArray(answers) ||
    answers.length === 0
  ) {
    return res.status(400).json({ error: "Invalid body" });
  }

  // helper: 0..3 -> 'A'..'D'
  const toLetter = (n: number | undefined | null) => {
    const map = ["A", "B", "C", "D"];
    const i = Number(n);
    return Number.isFinite(i) && i >= 0 && i < map.length ? map[i] : "A";
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Verify the session belongs to the caller and lock it
    const s = await client.query<{
      id: number;
      user_id: number;
      test_id: number;
      total_questions: number | null;
      finished_at: Date | null;
      correct_answer: number | null;
      raw_score: string | number | null;
    }>(
      `
      SELECT id, user_id, test_id, total_questions, finished_at, correct_answer, raw_score
      FROM exam_sessions
      WHERE id = $1
      FOR UPDATE
      `,
      [sessionId]
    );

    if (s.rowCount === 0 || Number(s.rows[0].user_id) !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    // Idempotency: if already finished, just return summary
    if (s.rows[0].finished_at) {
      await client.query("COMMIT");
      return res.status(200).json({
        sessionId,
        correctAnswers: s.rows[0].correct_answer ?? 0,
        totalQuestions: s.rows[0].total_questions ?? 0,
        score: Number(s.rows[0].raw_score ?? 0),
        finishedAt: s.rows[0].finished_at,
        alreadySubmitted: true,
      });
    }

    // 2) Validate submitted questions belong to this session
    const allowed = await client.query<{ question_id: number }>(
      `SELECT question_id FROM session_questions WHERE session_id = $1`,
      [sessionId]
    );
    const allowedSet = new Set(allowed.rows.map((r) => Number(r.question_id)));

    const filtered = answers.filter(
      (a) =>
        Number.isInteger(a.questionId) &&
        Number.isInteger(a.selectedIndex) &&
        a.selectedIndex >= 0 &&
        a.selectedIndex <= 3 &&
        allowedSet.has(Number(a.questionId))
    );

    if (filtered.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No valid answers to submit" });
    }

    // 3) Fetch the correct answers for those questions
    const qIds = filtered.map((a) => Number(a.questionId));
    const q = await client.query<{ id: number; correct_answer: number }>(
      `SELECT id, correct_answer FROM questions WHERE id = ANY($1::int[])`,
      [qIds]
    );
    const correctMap = new Map(
      q.rows.map((r) => [Number(r.id), Number(r.correct_answer)])
    );

    // 4) Upsert the answers
    let correctCount = 0;

    for (const a of filtered) {
      const qid = Number(a.questionId);
      const cidx = correctMap.get(qid);
      const isCorrect = typeof cidx === "number" && cidx === a.selectedIndex;
      if (isCorrect) correctCount += 1;

      await client.query(
        `
        INSERT INTO answers (session_id, question_id, selected_option, correct_answer, is_correct, time_taken_sec)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (session_id, question_id)
        DO UPDATE SET
          selected_option = EXCLUDED.selected_option,
          correct_answer  = EXCLUDED.correct_answer,
          is_correct      = EXCLUDED.is_correct,
          time_taken_sec  = EXCLUDED.time_taken_sec
        `,
        [
          sessionId,
          qid,
          toLetter(a.selectedIndex),
          toLetter(cidx ?? 0),
          isCorrect,
          Math.max(0, Number(a.timeTakenSeconds ?? 0)),
        ]
      );
    }

    // 5) Finalize the session
    // prefer the session's planned total_questions; fall back to the session set size
    const totalPlanned = Number(s.rows[0].total_questions);
    const total =
      Number.isFinite(totalPlanned) && totalPlanned > 0
        ? totalPlanned
        : allowedSet.size || filtered.length;

    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    const fin = await client.query(
      `
      UPDATE exam_sessions
         SET finished_at    = NOW(),
             correct_answer = $2,
             raw_score      = $3
       WHERE id = $1
       RETURNING id, finished_at, correct_answer, total_questions, raw_score
      `,
      [sessionId, correctCount, score]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      sessionId,
      correctAnswers: fin.rows[0].correct_answer,
      totalQuestions: fin.rows[0].total_questions ?? total,
      score: Number(fin.rows[0].raw_score),
      finishedAt: fin.rows[0].finished_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("[submitExam] error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * GET /api/attempts/mine
 * Returns attempt rows for the authenticated user.
 * items[] is left empty for now (can be filled from answers later).
 */

// Utility: dev-friendly error logging + safe response
function logAnd500(res: any, where: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[examController] ${where} failed:`, err);
  // In dev you can expose details; keep it generic in prod
  if (process.env.NODE_ENV === "development") {
    const e = err as any;
    return res.status(500).json({
      error: "Internal server error",
      where,
      code: e?.code ?? null,
      detail: e?.detail ?? e?.message ?? null,
    });
  }
  return res.status(500).json({ error: "Internal server error" });
}

/** GET /api/attempts/mine */
export const getMyAttempts: RequestHandler = async (req, res) => {
  try {
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const sql = `
      SELECT id, test_id, started_at, finished_at
      FROM exam_sessions
      WHERE user_id = $1
      ORDER BY started_at DESC
    `;
    const { rows } = await pool.query(sql, [userId]);

    const attempts = rows.map((r: any) => ({
      attemptId: String(r.id),
      candidate: String(userId),
      assignmentId: r.test_id != null ? String(r.test_id) : undefined,
      startedAt: r.started_at,
      completedAt: r.finished_at,
      items: [] as any[],
    }));

    return res.json(attempts);
  } catch (err) {
    return logAnd500(res, "getMyAttempts", err);
  }
};

/** GET /api/completions/mine  (?assignmentId=123 optional) */
export const getMyCompletions: RequestHandler = async (req, res) => {
  try {
    // ---- auth ----
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId))
      return res.status(400).json({ error: "Invalid user id" });

    // ---- optional filter ----
    const rawAssignmentId =
      (req.query.assignmentId as string | undefined) ?? undefined;
    const hasFilter = !!(rawAssignmentId && rawAssignmentId !== "");
    const assignmentId = hasFilter ? Number(rawAssignmentId) : undefined;
    if (hasFilter && !Number.isInteger(assignmentId)) {
      return res.status(400).json({ error: "Invalid assignmentId" });
    }

    // ---- introspect exam_sessions ----
    const wanted = [
      "id",
      "test_id",
      "finished_at",
      "total_questions",
      "correct_answers",
      "correct_answer",
      "raw_score",
    ];
    const colRes = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'exam_sessions'
        AND column_name  = ANY($1::text[])
      `,
      [wanted]
    );
    const have = new Set<string>(colRes.rows.map((r: any) => r.column_name));

    const hasId = have.has("id");
    const hasTestId = have.has("test_id");
    const hasFinishedAt = have.has("finished_at");
    const hasTotalQuestions = have.has("total_questions");
    const hasCorrectPlural = have.has("correct_answers");
    const hasCorrectSingle = have.has("correct_answer");
    const hasRawScore = have.has("raw_score");

    // Defensive: we need at least a finished_at to consider it a completion
    if (!hasFinishedAt) {
      return res.json([]); // nothing we can do sensibly
    }

    // Build safe SELECT pieces
    const selTestId = hasTestId
      ? "COALESCE(test_id, 0)::int AS test_id"
      : "0::int AS test_id";
    const selTotal = hasTotalQuestions
      ? "COALESCE(total_questions, 0) AS total_questions"
      : "0 AS total_questions";
    const selCorrectExpr =
      hasCorrectPlural || hasCorrectSingle
        ? `COALESCE(${hasCorrectPlural ? "correct_answers" : "NULL"}, ${
            hasCorrectSingle ? "correct_answer" : "NULL"
          }, 0)`
        : "0";
    const selCorrect = `${selCorrectExpr} AS correct_cnt`;
    // Prefer stored raw_score if it exists; else compute on the fly
    const selScore = hasRawScore
      ? `
        COALESCE(
          raw_score,
          CASE
            WHEN COALESCE(${hasTotalQuestions ? "total_questions" : "0"},0) > 0
              THEN ROUND(100.0 * ${selCorrectExpr} / ${
          hasTotalQuestions ? "total_questions" : "1"
        })
            ELSE 0
          END
        ) AS score
      `
      : `
        CASE
          WHEN COALESCE(${hasTotalQuestions ? "total_questions" : "0"},0) > 0
            THEN ROUND(100.0 * ${selCorrectExpr} / ${
          hasTotalQuestions ? "total_questions" : "1"
        })
          ELSE 0
        END AS score
      `;

    // WHERE pieces
    const where: string[] = [`user_id = $1`, `finished_at IS NOT NULL`];
    const params: any[] = [userId];

    // Only add assignment filter if test_id exists in this DB
    if (hasFilter && hasTestId) {
      where.push(`test_id = $2::int`);
      params.push(assignmentId);
    }

    const sql = `
      SELECT
        ${selTestId},
        finished_at AS completed_at,
        ${selTotal},
        ${selCorrect},
        ${selScore}
      FROM exam_sessions
      WHERE ${where.join(" AND ")}
      ORDER BY finished_at DESC NULLS LAST ${hasId ? ", id DESC" : ""}
    `;

    const { rows } = await pool.query(sql, params);

    const mapRow = (r: any) => ({
      assignmentId: String(r.test_id), // FE expects string
      candidate: String(userId),
      completedAt: r.completed_at,
      total: Number(r.total_questions ?? 0),
      correct: Number(r.correct_cnt ?? 0),
      score: Number(r.score ?? 0),
    });

    if (hasFilter && hasTestId) {
      // Return a single object or null for “is completed?” checks
      return res.json(rows.length ? mapRow(rows[0]) : null);
    }

    return res.json(rows.map(mapRow));
  } catch (err: any) {
    console.error("[getMyCompletions] FAILED", {
      code: err?.code,
      detail: err?.detail,
      message: err?.message,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "getMyCompletions",
      code: err?.code ?? null,
      detail: err?.detail ?? err?.message ?? null,
    });
  }
};

/**
 * GET /api/sessions/:id/topic
 * Returns the topic from the FIRST question in the session (position ASC).
 */
export const getSessionTopic: RequestHandler = async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const { rows } = await pool.query(
      `SELECT q.topic
         FROM session_questions sq
         JOIN questions q ON q.id = sq.question_id
        WHERE sq.session_id = $1
        ORDER BY sq.position ASC
        LIMIT 1`,
      [sessionId]
    );

    const topic: string | null = rows[0]?.topic ?? null;
    res.json({ sessionId, topic });
  } catch (err) {
    const e = err as any;
    console.error("[getMyCompletions] FAILED", {
      code: e?.code,
      detail: e?.detail,
      message: e?.message,
      stack: e?.stack,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "getMyCompletions",
      code: e?.code ?? null,
      detail: e?.detail ?? e?.message ?? null,
    });
  }
};

/**
 * GET /api/sessions/mine
 * Returns the candidate's sessions with topic resolved from the FIRST question.
 */
export const getMySessionsWithTopic: RequestHandler = async (req, res) => {
  try {
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId))
      return res.status(400).json({ error: "Invalid user id" });

    // Pull the topic via a LATERAL subselect (first question by position)
    const sql = `
      SELECT
        es.id                         AS session_id,
        es.test_id                    AS test_id,
        es.user_id                    AS user_id,
        es.started_at,
        es.finished_at,
        es.total_questions,
        es.correct_answer,
        COALESCE(tq.topic, NULL)      AS topic
      FROM exam_sessions es
      LEFT JOIN LATERAL (
        SELECT q.topic
        FROM session_questions sq
        JOIN questions q ON q.id = sq.question_id
        WHERE sq.session_id = es.id
        ORDER BY sq.position ASC
        LIMIT 1
      ) tq ON TRUE
      WHERE es.user_id = $1
      ORDER BY es.started_at DESC NULLS LAST, es.id DESC
    `;
    const { rows } = await pool.query(sql, [userId]);

    // Keep your existing FE field names to avoid churn
    const out = rows.map((r: any) => ({
      attemptId: String(r.session_id),
      assignmentId: r.test_id != null ? String(r.test_id) : undefined,
      candidate: String(r.user_id),
      startedAt: r.started_at,
      completedAt: r.finished_at,
      totalQuestions: Number(r.total_questions ?? 0),
      correctAnswers: Number(r.correct_answer ?? 0),
      topic: r.topic ?? null,
    }));

    res.json(out);
  } catch (err) {
    const e = err as any;
    console.error("[getMySessionsWithTopic] FAILED", {
      code: e?.code,
      detail: e?.detail,
      message: e?.message,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "getMySessionsWithTopic",
      code: e?.code ?? null,
      detail: e?.detail ?? e?.message ?? null,
    });
  }
};

/**
 * GET /api/sessions/:id/questions
 * Returns ordered questions for a session, only if it belongs to the user.
 * (Does NOT include the correct answer.)
 */
// server/controllers/examController.ts
export const getSessionQuestions: RequestHandler = async (req, res) => {
  try {
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId))
      return res.status(400).json({ error: "Invalid user id" });

    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId))
      return res.status(400).json({ error: "Invalid session id" });

    // ownership check
    const own = await pool.query(
      "SELECT 1 FROM exam_sessions WHERE id = $1 AND user_id = $2",
      [sessionId, userId]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "Forbidden" });

    const sql = `
      SELECT
        sq.position,
        q.id                AS question_id,
        q.question_text     AS question_text,
        q.options           AS options,
        q.type              AS type,
        q.topic             AS topic,
        q.difficulty        AS difficulty
      FROM session_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.session_id = $1
      ORDER BY sq.position ASC
    `;
    const { rows } = await pool.query(sql, [sessionId]);

    const out = rows.map((r) => ({
      position: Number(r.position),
      questionId: Number(r.question_id),
      questionText: r.question_text ?? "",
      options: r.options ?? [],
      type: r.type ?? "MCQ",
      topic: r.topic ?? null,
      difficulty: Number(r.difficulty ?? 1),
    }));

    res.json(out);
  } catch (e: any) {
    console.error("[getSessionQuestions] FAILED", e);
    return res.status(500).json({
      error: "Internal server error",
      where: "getSessionQuestions",
      code: e?.code ?? null,
      detail: e?.detail ?? e?.message ?? null,
    });
  }
};
