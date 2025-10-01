import { RequestHandler } from "express";
import pool from "../config/db";
// new adaptive + elo helpers (your files)
import {
  batmExpectedMs,
  aggregateStage,
  routeStage,
  nextLevel,
  CTConfig,
} from "../services/adaptive"; // uses your adaptive.ts

import { bandFromElo, updateEloPair, expected } from "../services/elo"; // uses your elo.ts
import { z } from "zod";
import { enforceTimeAndMaybeFinish } from "./timeController";

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
  timeTakenSeconds: z.number().int().min(0).optional(),
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

  const testIdRaw = body.testId ?? body.examId ?? body.assignmentId;
  const inputTestId = Number(testIdRaw);
  if (!Number.isFinite(inputTestId) || inputTestId <= 0) {
    return res.status(400).json({ error: "Missing or invalid testId" });
  }

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

  const limNum = Number(body.limit);
  const totalLimit =
    Number.isFinite(limNum) && limNum > 0
      ? Math.min(100, Math.floor(limNum))
      : 10;

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

    /* Helpers for "published" detection (status/is_published variants) */
    const cols = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'questions'
        AND column_name  IN ('status','is_published','published_at','published_by','topic','difficulty')
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

    /* ───────────── 2a) (Optional) Pull topic/difficulty from tests if columns exist ───────────── */
    let testTopicPick: string | null = null;
    let testDifficultyPick: number | null = null;

    const testTopicRow = await client.query<{ topic: string | null }>(
      `SELECT topic FROM tests WHERE id = $1`,
      [inputTestId]
    );
    const topicFromTests = (testTopicRow.rows[0]?.topic ?? "").trim();
    if (!testTopicPick && topicFromTests) {
      testTopicPick = topicFromTests;
    }

    const testCols = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'tests'
        AND column_name  IN ('topic_pick','difficulty_pick')
      `
    );
    const testHave = new Set(testCols.rows.map((r) => r.column_name));

    if (testHave.size > 0) {
      const selectPieces: string[] = [];
      if (testHave.has("topic_pick")) {
        selectPieces.push(
          `NULLIF(TRIM(COALESCE(topic_pick, '')), '') AS topic_pick`
        );
      } else {
        selectPieces.push(`NULL AS topic_pick`);
      }
      if (testHave.has("difficulty_pick")) {
        selectPieces.push(`difficulty_pick AS difficulty_pick`);
      } else {
        selectPieces.push(`NULL::int AS difficulty_pick`);
      }
      const meta = await client.query<{
        topic_pick: string | null;
        difficulty_pick: number | string | null;
      }>(
        `
        SELECT ${selectPieces.join(", ")}
        FROM tests
        WHERE id = $1
        LIMIT 1
        `,
        [inputTestId]
      );

      const diffMap: Record<string, number> = {
        "very easy": 1,
        easy: 2,
        medium: 3,
        hard: 4,
        "very hard": 5,
      };

      testTopicPick =
        meta.rows?.[0]?.topic_pick ?? null
          ? String(meta.rows[0]!.topic_pick).trim()
          : null;

      const rawDiff = meta.rows?.[0]?.difficulty_pick ?? null;
      testDifficultyPick =
        rawDiff == null
          ? null
          : typeof rawDiff === "number"
          ? rawDiff
          : diffMap[String(rawDiff).trim().toLowerCase()] ?? null;
    }

    // Final topic/difficulty to enforce in auto-pick
    const chosenTopics =
      topicsArr.length > 0
        ? topicsArr
        : testTopicPick
        ? [testTopicPick.toLowerCase()]
        : [];
    const difficultyPickNum =
      testDifficultyPick != null && Number.isFinite(testDifficultyPick)
        ? Number(testDifficultyPick)
        : null;

    /* Helper: build a fresh question set (curated first, else auto-pick) */
    const buildQuestionSet = async () => {
      // curated
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
          .slice(0, totalLimit)
          .map((r, i) => ({ question_id: r.question_id, position: i + 1 }));
      }

      // auto-pick (STRICT by topic if topics/assignment topic exist; optional difficulty)
      if (have.has("topic") && chosenTopics.length > 0) {
        const perTopic = Math.max(
          1,
          Math.floor(totalLimit / Math.max(chosenTopics.length, 1))
        );

        const auto = await client.query<{ id: number }>(
          `
          WITH base AS (
            SELECT q.id, LOWER(q.topic) AS topic
            FROM questions q
            WHERE ${publishedWhere("q")}
              AND LOWER(q.topic) = ANY($2)                     -- topic filter
              AND ($3::int IS NULL OR q.difficulty = $3)       -- optional difficulty
          ),
          ranked AS (
            SELECT id, topic,
                   ROW_NUMBER() OVER (PARTITION BY topic ORDER BY RANDOM()) AS rn
            FROM base
          ),
          picked AS (
            SELECT id FROM ranked WHERE rn <= $4
          ),
          fill AS (
            SELECT id FROM base
            WHERE id NOT IN (SELECT id FROM picked)
            ORDER BY RANDOM()
            LIMIT GREATEST($1 - (SELECT COUNT(*) FROM picked), 0)
          )
          SELECT id FROM picked
          UNION ALL
          SELECT id FROM fill
          LIMIT $1
          `,
          [totalLimit, chosenTopics, difficultyPickNum, perTopic]
        );

        return auto.rows.map((r, idx) => ({
          question_id: r.id,
          position: idx + 1,
        }));
      }

      // Fallback: no topic column or no topic configured – keep original behavior,
      // but still respect optional difficulty if the column exists.
      const auto = await client.query<{ id: number }>(
        `
        SELECT q.id
        FROM questions q
        WHERE ${publishedWhere("q")}
          AND ($2::int IS NULL OR q.difficulty = $2)
        ORDER BY RANDOM()
        LIMIT $1
        `,
        [totalLimit, difficultyPickNum]
      );
      return auto.rows.map((r, idx) => ({
        question_id: r.id,
        position: idx + 1,
      }));
    };

    /* ───────────── 2.1) Reuse unfinished session if exists ───────────── */
    const existing = await client.query<{
      id: number;
      total_questions: number | null;
      total_time_seconds: number | null;
      time_remaining_seconds?: number | null;
      deadline_at?: Date | null;
      last_event_at?: Date | null;
    }>(
      `
      SELECT id, total_questions, total_time_seconds,
             time_remaining_seconds, deadline_at, last_event_at
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

      // Ensure frozen set exists
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
            details: { topics: chosenTopics, limit: totalLimit },
          });
        }
        // Insert frozen set
        const values = chosen
          .map((_, i) => `($1,$${i * 2 + 2},$${i * 2 + 3})`)
          .join(",");
        const params: any[] = [row.id];
        chosen.forEach((c) => params.push(c.question_id, c.position));
        await client.query(
          `INSERT INTO session_questions (session_id, question_id, position) VALUES ${values}`,
          params
        );

        await client.query(
          `UPDATE exam_sessions SET total_questions = $2 WHERE id = $1`,
          [row.id, chosen.length]
        );
      }

      // ▼ Backfill timer fields if missing (so the timer "sticks")
      await client.query(
        `
        UPDATE exam_sessions
           SET time_remaining_seconds = COALESCE(time_remaining_seconds, total_time_seconds),
               deadline_at = COALESCE(
                 deadline_at,
                 CASE
                   WHEN total_time_seconds IS NOT NULL THEN started_at + make_interval(secs => total_time_seconds)
                   ELSE NULL
                 END
               ),
               last_event_at = COALESCE(last_event_at, NOW())
         WHERE id = $1
        `,
        [row.id]
      );

      // Seed adaptive state quietly if missing
      const userEloRow = await client.query(
        `SELECT COALESCE(elo_rating, 1000)::int AS elo_rating FROM users WHERE id = $1`,
        [userId]
      );
      const userElo = Number(userEloRow.rows[0]?.elo_rating ?? 1000);
      const startLevel = bandFromElo(userElo) as 1 | 2 | 3 | 4 | 5;

      const cfg: CTConfig = {
        stageSize: 10,
        difficultyFactors: { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 },
        timeWeights: { 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8 },
        routing: {
          promote: { minStageScore: 9.0, minAccuracy: 0.75 },
          hold: {
            stageScoreRange: [7.0, 9.0],
            or: { minAccuracy: 0.8, minAvgR: 1.0 },
          },
          demote: { maxStageScore: 7.0, or: { maxAccuracy: 0.6 } },
          guards: { maxWrongFastForPromotion: 2 },
        },
      };

      await client.query(
        `UPDATE exam_sessions
           SET current_level = COALESCE(current_level, $2),
               stage_index = COALESCE(stage_index, 0),
               config = COALESCE(config, $3)
         WHERE id = $1`,
        [row.id, startLevel, JSON.stringify(cfg)]
      );

      await client.query("COMMIT");
      return res.status(200).json({
        sessionId: row.id,
        attemptId: row.id,
        testId: inputTestId,
        totalQuestions: row.total_questions ?? undefined,
        totalTimeSeconds: row.total_time_seconds ?? undefined,
        userId,
        reused: true,
        timeRemainingSeconds:
          row.time_remaining_seconds ?? row.total_time_seconds ?? null,
        deadlineAt: row.deadline_at ?? null,
      });
    }

    /* ───────────── 3–4) Build fresh set ───────────── */
    const chosen = await buildQuestionSet();
    if (chosen.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No published questions available for the requested criteria",
        details: { topics: chosenTopics, limit: totalLimit },
      });
    }

    /* ───────────── 5) Create the session ───────────── */
    const s = await client.query(
      `INSERT INTO exam_sessions
         (user_id, test_id, started_at, total_questions,
          total_time_seconds, time_remaining_seconds, deadline_at, last_event_at)
       VALUES ($1, $2, NOW(), $3,
               $4,
               $4,
               CASE WHEN $4 IS NOT NULL
                    THEN NOW() + ($4 || ' seconds')::interval
                    ELSE NULL END,
               NOW())
       RETURNING id, total_questions, total_time_seconds, time_remaining_seconds, deadline_at`,
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

    // Seed adaptive state quietly (no outward API change)
    const userEloRow = await client.query(
      `SELECT COALESCE(elo_rating, 1000)::int AS elo_rating FROM users WHERE id = $1`,
      [userId]
    );
    const userElo = Number(userEloRow.rows[0]?.elo_rating ?? 1000);
    const startLevel = bandFromElo(userElo) as 1 | 2 | 3 | 4 | 5;

    const cfg: CTConfig = {
      stageSize: 10,
      difficultyFactors: { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 },
      timeWeights: { 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8 },
      routing: {
        promote: { minStageScore: 9.0, minAccuracy: 0.75 },
        hold: {
          stageScoreRange: [7.0, 9.0],
          or: { minAccuracy: 0.8, minAvgR: 1.0 },
        },
        demote: { maxStageScore: 7.0, or: { maxAccuracy: 0.6 } },
        guards: { maxWrongFastForPromotion: 2 },
      },
    };

    await client.query(
      `UPDATE exam_sessions
         SET current_level = $2,
             stage_index = 0,
             config = $3
       WHERE id = $1`,
      [sessionId, startLevel, JSON.stringify(cfg)]
    );

    console.info(
      "[adaptive.start]",
      JSON.stringify({
        scope: "exam",
        event: "session-seeded",
        sessionId,
        userId,
        testId: inputTestId,
        totalQuestions,
        totalTimeSeconds: storedDuration,
        seed: {
          userElo,
          startLevel,
          config: cfg,
        },
        topics: chosenTopics.length ? chosenTopics : undefined,
      })
    );

    await client.query("COMMIT");

    return res.status(201).json({
      sessionId,
      attemptId: sessionId,
      testId: inputTestId,
      totalQuestions,
      totalTimeSeconds: storedDuration,
      userId,
      topics: chosenTopics.length ? chosenTopics : undefined,
      limit: totalLimit,
      curatedUsed: true,
      timeRemainingSeconds:
        s.rows[0].time_remaining_seconds ?? storedDuration ?? null,
      deadlineAt: s.rows[0].deadline_at ?? null,
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
  const uid = (req as any)?.user?.uid; // unchanged
  const { sessionId } = (req.body ?? {}) as { sessionId: number };
  // Enforce timer
  const time = await enforceTimeAndMaybeFinish(sessionId);
  if (time.finished) {
    return res.status(409).json({ error: "Time up", finished: true });
  }

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    // 1) Ensure session belongs to user
    const { rows: srows } = await pool.query(
      `
      SELECT s.id, s.test_id, s.current_level, s.time_remaining_seconds,
             s.total_questions, s.config, u.id AS user_id
      FROM exam_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.firebase_uid = $2
      `,
      [sessionId, uid]
    );
    if (srows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sess = srows[0];
    const currentLevel = Math.min(
      5,
      Math.max(1, Number(sess.current_level ?? 3))
    ) as 1 | 2 | 3 | 4 | 5;
    const timeRemainingSec = Number(sess.time_remaining_seconds ?? 0);
    const totalQs = Number(sess.total_questions ?? 10);
    const cfg: CTConfig =
      sess.config ??
      ({
        stageSize: 10,
        difficultyFactors: { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 },
        timeWeights: { 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8 },
        routing: {
          promote: { minStageScore: 9.0, minAccuracy: 0.75 },
          hold: {
            stageScoreRange: [7.0, 9.0],
            or: { minAccuracy: 0.8, minAvgR: 1.0 },
          },
          demote: { maxStageScore: 7.0, or: { maxAccuracy: 0.6 } },
          guards: { maxWrongFastForPromotion: 2 },
        },
      } as CTConfig);

    // 2) Already answered count (to compute remaining & expected time)
    const { rows: arows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM answers WHERE session_id = $1`,
      [sessionId]
    );
    const answeredCount = Number(arows[0]?.cnt ?? 0);
    const remainingQuestions = Math.max(1, totalQs - answeredCount);

    // 3) Compute expected time for next item (BATM)
    const tExpectedMs = batmExpectedMs(
      timeRemainingSec,
      remainingQuestions,
      currentLevel,
      cfg.timeWeights
    );

    // 4) Pick the next unseen question from the frozen set, preferring the current difficulty
    const preferred = await pool.query(
      `
      SELECT
        q.id,
        q.question_text,
        q.options,
        q.correct_answer,
        q.difficulty
      FROM session_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.session_id = $1
        AND q.difficulty = $2
        AND NOT EXISTS (
          SELECT 1 FROM answers a WHERE a.session_id = $1 AND a.question_id = q.id
        )
      ORDER BY sq.position ASC
      LIMIT 1
      `,
      [sessionId, currentLevel]
    );

    let qrow = preferred.rows[0];

    // fallback: next unseen regardless of difficulty to avoid blocking
    if (!qrow) {
      const fb = await pool.query(
        `
        SELECT
          q.id,
          q.question_text,
          q.options,
          q.correct_answer,
          q.difficulty
        FROM session_questions sq
        JOIN questions q ON q.id = sq.question_id
        WHERE sq.session_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM answers a WHERE a.session_id = $1 AND a.question_id = q.id
          )
        ORDER BY sq.position ASC
        LIMIT 1
        `,
        [sessionId]
      );
      qrow = fb.rows[0];
    }

    if (!qrow) {
      return res.status(404).json({ error: "No question available" });
    }
    // --- DEVOPS NEXT-QUESTION LOG ---
    try {
      // fetch current user & item ELOs
      const [{ rows: urows }, { rows: irows }] = await Promise.all([
        pool.query(
          `SELECT COALESCE(elo_rating, 1000)::int AS elo FROM users WHERE id = $1`,
          [sess.user_id]
        ),
        pool.query(
          `SELECT COALESCE(elo_rating, 1000)::int AS elo FROM questions WHERE id = $1`,
          [qrow.id]
        ),
      ]);

      const userElo = Number(urows?.[0]?.elo ?? 1000);
      const itemElo = Number(irows?.[0]?.elo ?? 1000);
      const p = expected(userElo, itemElo); // win probability (0..1)

      console.info(
        "[adaptive.next]",
        JSON.stringify({
          sessionId,
          currentLevel,
          nextQuestionId: qrow.id,
          difficulty: qrow.difficulty,
          eloTarget: {
            userElo,
            itemElo,
            expectedWinProb: Number(p.toFixed(3)),
          },
          time: {
            remainingSec: timeRemainingSec,
            expectedMs: tExpectedMs,
          },
        })
      );
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : JSON.stringify(err);
      console.warn("[adaptive.next] log failed:", detail);
    }

    // --- END DEVOPS NEXT-QUESTION LOG ---

    return res.json({
      question: {
        id: qrow.id,
        question_text: qrow.question_text,
        options: qrow.options,
        difficulty: qrow.difficulty,
        tExpectedMs, // optional for FE; safe to ignore
      },
      timeRemainingSeconds: time.remaining,
      deadlineAt: time.deadlineAt,
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
    const time = await enforceTimeAndMaybeFinish(sessionId);
    if (time.finished) {
      return res.status(409).json({ error: "Time up", finished: true });
    }

    const sRes = await pool.query(
      `SELECT user_id, finished_at, current_level, time_remaining_seconds, total_questions, config
         FROM exam_sessions
        WHERE id = $1`,
      [sessionId]
    );
    if (sRes.rowCount === 0)
      return res.status(404).json({ error: "Session not found" });
    if (Number(sRes.rows[0].user_id) !== Number(authedUserId))
      return res.status(403).json({ error: "Forbidden" });

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

    // 4.1) Compute expected time (server-side) for this item (BATM)
    const sess = sRes.rows[0];
    const cfg: CTConfig =
      sess.config ??
      ({
        stageSize: 10,
        difficultyFactors: { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 },
        timeWeights: { 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8 },
        routing: {
          promote: { minStageScore: 9.0, minAccuracy: 0.75 },
          hold: {
            stageScoreRange: [7.0, 9.0],
            or: { minAccuracy: 0.8, minAvgR: 1.0 },
          },
          demote: { maxStageScore: 7.0, or: { maxAccuracy: 0.6 } },
          guards: { maxWrongFastForPromotion: 2 },
        },
      } as CTConfig);

    const currentLevel = Math.min(
      5,
      Math.max(1, Number(sess.current_level ?? q.difficulty ?? 3))
    ) as 1 | 2 | 3 | 4 | 5;

    const answeredCountRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM answers WHERE session_id = $1`,
      [sessionId]
    );
    const totalQs = Number(sess.total_questions ?? 10);
    const answeredCount = Number(answeredCountRes.rows[0]?.cnt ?? 0);
    const remainingQuestions = Math.max(1, totalQs - answeredCount);
    const expectedMs = batmExpectedMs(
      Number(sess.time_remaining_seconds ?? 0),
      remainingQuestions,
      currentLevel,
      cfg.timeWeights
    );
    const actualMs = Math.max(0, Number(timeTakenSeconds ?? 0) * 1000);
    const r = Math.max(0, actualMs / Math.max(1, expectedMs));
    const expectedSec = Math.round(expectedMs / 1000);

    // 5) Upsert the answer (unchanged core shape)
    const selChar = String(selectedIndex) as "0" | "1" | "2" | "3";
    const corChar = String(correctIndex) as "0" | "1" | "2" | "3";

    const aRes = await pool.query(
      `INSERT INTO answers
     (session_id, question_id, selected_option, correct_answer, is_correct,
      time_taken_seconds, question_difficulty, question_elo, expected_time_seconds)
   VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7, $8, $9)
   ON CONFLICT (session_id, question_id) DO UPDATE
     SET selected_option        = EXCLUDED.selected_option,
         correct_answer         = EXCLUDED.correct_answer,
         is_correct             = EXCLUDED.is_correct,
         time_taken_seconds     = EXCLUDED.time_taken_seconds,
         question_difficulty    = EXCLUDED.question_difficulty,
         question_elo           = EXCLUDED.question_elo,
         expected_time_seconds  = EXCLUDED.expected_time_seconds
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
        expectedSec, // <-- NEW: store expected time for this item
      ]
    );

    // 6) Elo update (quiet; no payload change)
    const userEloRow = await pool.query(
      `SELECT COALESCE(elo_rating, 1000)::int AS elo_rating FROM users WHERE id = $1`,
      [authedUserId]
    );
    const curUserElo = Number(userEloRow.rows[0]?.elo_rating ?? 1000);
    const itemElo = Number(q.elo_rating ?? 1000);

    const {
      userAfter,
      itemAfter,
      expected: pExp,
      actual: aActual,
      dUser,
      dItem,
    } = updateEloPair(curUserElo, itemElo, isCorrect, r, 16, 8);

    await pool.query(
      `UPDATE users SET elo_rating = $2, elo_last_updated = NOW() WHERE id = $1`,
      [authedUserId, userAfter]
    );
    await pool.query(
      `UPDATE questions SET elo_rating = $2, elo_exposure = COALESCE(elo_exposure,0)+1 WHERE id = $1`,
      [questionId, itemAfter]
    );

    // --- DEVOPS ELO-UPDATE LOG ---
    console.info(
      "[adaptive.elo]",
      JSON.stringify({
        sessionId,
        questionId,
        isCorrect,
        paceRatio: r, // time ratio guard used in your score function
        elo: {
          userBefore: curUserElo,
          itemBefore: itemElo,
          expectedWinProb: Number(pExp.toFixed(3)),
          actualScore: Number(aActual.toFixed(3)),
          dUser: Math.round(dUser),
          dItem: Math.round(dItem),
          userAfter,
          itemAfter,
        },
      })
    );
    // --- END DEVOPS ELO-UPDATE LOG ---

    // 7) Decrement remaining time (quiet)
    await pool.query(
      `UPDATE exam_sessions
         SET time_remaining_seconds = GREATEST(0, COALESCE(time_remaining_seconds, 0) - $2)
       WHERE id = $1`,
      [sessionId, Math.round(actualMs / 1000)]
    );

    // (Optional) Stage routing at boundaries — we keep it quiet and non-breaking.
    // If you want to enable routing now, uncomment the block below and ensure answers
    // has enough data to compute r per item (we approximated with expectedMs above).

    const afterCountRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM answers WHERE session_id = $1`,
      [sessionId]
    );
    const answeredNow = Number(afterCountRes.rows[0]?.cnt ?? 0);
    if (answeredNow % cfg.stageSize === 0) {
      const block = await pool.query(
        `
  SELECT is_correct, time_taken_seconds, expected_time_seconds
  FROM answers
  WHERE session_id = $1
  ORDER BY id DESC
  LIMIT $2
  `,
        [sessionId, cfg.stageSize]
      );

      const items = block.rows.map((r0: any) => {
        const ms = Math.max(1, Number(r0.time_taken_seconds ?? 0) * 1000);
        const exp = Math.max(
          1,
          Math.round(Number(r0.expected_time_seconds ?? expectedSec) * 1000)
        );
        const rr = ms / exp;
        const timeBonus = rr <= 0.8 ? 0.2 : rr <= 1.2 ? 0.1 : 0.0;
        const guessPenalty = !r0.is_correct && rr <= 0.8 ? -0.2 : 0.0;
        const sc = Math.max(
          -0.2,
          Math.min(
            1.5,
            (cfg.difficultyFactors[currentLevel] ?? 1) *
              ((r0.is_correct ? 1 : 0) + timeBonus) +
              guessPenalty
          )
        );
        return { correct: !!r0.is_correct, r: rr, score: sc };
      });

      const agg = aggregateStage(items);
      const route = routeStage(agg, cfg);
      const lvl = nextLevel(currentLevel, route);
      // --- DEVOPS ROUTING LOG ---
      console.info(
        "[adaptive.route]",
        JSON.stringify({
          sessionId,
          stage: {
            size: cfg.stageSize,
            index: (sess?.stage_index ?? 0) + 1, // next stage index from your UPDATE
            aggregates: {
              accuracy: Number(agg.accuracy.toFixed(3)),
              avgR: Number(agg.avgR.toFixed(3)),
              stageScore: Number(agg.stageScore.toFixed(3)),
              wrongFast: agg.wrongFast,
            },
          },
          policy: cfg.routing, // thresholds used
          decision: {
            fromLevel: currentLevel,
            route, // "PROMOTE" | "HOLD" | "DEMOTE"
            toLevel: lvl,
          },
        })
      );
      // --- END DEVOPS ROUTING LOG ---

      await pool.query(
        `UPDATE exam_sessions SET current_level = $2, stage_index = COALESCE(stage_index,0)+1 WHERE id = $1`,
        [sessionId, lvl]
      );
    }

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

  if (
    !Number.isInteger(sessionId) ||
    !Array.isArray(answers) ||
    answers.length === 0
  ) {
    return res.status(400).json({ error: "Invalid body" });
  }

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

    // 3) Fetch the correct answers
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

    // 5) Finalize
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
    console.error("[submitExam] error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
};

// Utility: dev-friendly error logging + safe response
function logAnd500(res: any, where: string, err: unknown) {
  console.error(`[examController] ${where} failed:`, err);
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
    const rawUserId = (req as any)?.user?.id;
    if (rawUserId == null)
      return res.status(401).json({ error: "Unauthenticated" });
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId))
      return res.status(400).json({ error: "Invalid user id" });

    const rawAssignmentId =
      (req.query.assignmentId as string | undefined) ?? undefined;
    const hasFilter = !!(rawAssignmentId && rawAssignmentId !== "");
    const assignmentId = hasFilter ? Number(rawAssignmentId) : undefined;
    if (hasFilter && !Number.isInteger(assignmentId)) {
      return res.status(400).json({ error: "Invalid assignmentId" });
    }

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

    const hasTestId = have.has("test_id");
    const hasFinishedAt = have.has("finished_at");
    const hasTotalQuestions = have.has("total_questions");
    const hasCorrectPlural = have.has("correct_answers");
    const hasCorrectSingle = have.has("correct_answer");
    const hasRawScore = have.has("raw_score");

    if (!hasFinishedAt) {
      return res.json([]);
    }

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

    const where: string[] = [`user_id = $1`, `finished_at IS NOT NULL`];
    const params: any[] = [userId];

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
      ORDER BY finished_at DESC NULLS LAST, id DESC
    `;

    const { rows } = await pool.query(sql, params);

    const mapRow = (r: any) => ({
      assignmentId: String(r.test_id),
      candidate: String(userId),
      completedAt: r.completed_at,
      total: Number(r.total_questions ?? 0),
      correct: Number(r.correct_cnt ?? 0),
      score: Number(r.score ?? 0),
    });

    if (hasFilter && hasTestId) {
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
  } catch (err: any) {
    console.error("[getSessionTopic] FAILED", {
      code: err?.code,
      detail: err?.detail,
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "getSessionTopic",
      code: err?.code ?? null,
      detail: err?.detail ?? err?.message ?? null,
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
  } catch (err: any) {
    console.error("[getMySessionsWithTopic] FAILED", {
      code: err?.code,
      detail: err?.detail,
      message: err?.message,
    });
    return res.status(500).json({
      error: "Internal server error",
      where: "getMySessionsWithTopic",
      code: err?.code ?? null,
      detail: err?.detail ?? err?.message ?? null,
    });
  }
};

/**
 * GET /api/sessions/:id/questions
 * Returns ordered questions for a session, only if it belongs to the user.
 * (Does NOT include the correct answer.)
 */
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

export const getRemaining: RequestHandler = async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const { rows } = await pool.query(
      `SELECT time_remaining_seconds, deadline_at, finished_at
         FROM exam_sessions
        WHERE id = $1`,
      [sessionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const r = rows[0];
    res.json({
      remaining: Math.max(0, Number(r.time_remaining_seconds ?? 0)),
      deadlineAt: r.deadline_at,
      finished: !!r.finished_at,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
};
