import type { RequestHandler } from "express";
import { z } from "zod";
import pool from "../config/db";

export const listAssignments: RequestHandler = async (_req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(_req.query.limit) || 100));
  const offset = Math.max(0, Number(_req.query.offset) || 0);

  const client = await pool.connect();
  try {
    const q = `
      SELECT
        s.id                              AS id,            -- keep "id" for FE
        s.id                              AS session_id,    -- extra aliases for FE fallbacks
        s.user_id,
        s.started_at,
        s.finished_at,
        s.total_questions,
        u.name                            AS candidate_name
      FROM exam_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.finished_at IS NULL
      ORDER BY s.started_at DESC
      LIMIT $1 OFFSET $2
    `;
    const rows = (await client.query(q, [limit, offset])).rows;
    // return a bare array (simplest), FE also supports {items:[...]}
    res.json(rows);
  } catch (err) {
    console.error("listOpenAssignments error:", err);
    res.status(500).json({ error: "Failed to list assignments" });
  } finally {
    client.release();
  }
};

type AuthedReq = import("express").Request & {
  user?: { id: number; role: string; name?: string; email?: string };
};

export const listMyAssignments: RequestHandler = async (req, res) => {
  const me = req.user;
  if (!me?.id) return res.status(401).json({ error: "Unauthorized" });

  try {
    const q = await pool.query(
      `
      SELECT
       s.id,
       s.user_id,
       s.test_id,
       s.started_at,
       s.finished_at,
       s.total_questions,
       t.topic AS test_topic
      FROM exam_sessions s
      LEFT JOIN tests t ON t.id = s.test_id
      WHERE s.user_id = $1
      ORDER BY s.started_at DESC;
      `,
      [me.id]
    );
    return res.json(q.rows);
  } catch (err) {
    console.error("listMyAssignments error:", err);
    return res.status(500).json({
      error: "Failed to list my assignments",
      where: "listMyAssignments",
    });
  }
};

export const createAssignment: RequestHandler = async (req, res) => {
  // TODO: validate & insert into DB
  // Return a created object so FE can render it
  const created = {
    id: String(Date.now()),
    candidateIds: req.body.candidateIds ?? [],
    questionIds: req.body.questionIds ?? [],
    config: req.body.config ?? {},
    schedule: req.body.schedule ?? {},
    status: "scheduled",
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(created);
};

const TABLE_SESSION_QUESTIONS = "session_questions"; // change here if your table name differs
const DEV = process.env.NODE_ENV !== "production";
const fail = (res: any, http: number, where: string, err?: unknown) =>
  res.status(http).json({
    error: "Failed to create session",
    where,
    detail: DEV
      ? err instanceof Error
        ? err.message
        : String(err)
      : undefined,
  });

export const createSessionForCandidate: RequestHandler = async (req, res) => {
  // ——— helpers ———
  const toMinutes = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === "string") {
      const m = v.match(/^\s*(\d+)\s*(m|min|minutes?)?\s*$/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  };

  // ——— input normalization ———
  const b = req.body ?? {};
  console.log("[createSessionForCandidate] body =", b);

  // time: accept many shapes (wizard variants)
  const minutes =
    toMinutes(b.allowedTimeMinutes) ??
    toMinutes(b.timeLimitMinutes) ??
    toMinutes(b.timeLimit) ??
    toMinutes(b.durationMinutes) ??
    toMinutes(b.duration) ??
    toMinutes(b?.config?.allowedTimeMinutes) ??
    toMinutes(b?.config?.timeLimitMinutes) ??
    toMinutes(b?.config?.timeLimit) ??
    toMinutes(b?.config?.durationMinutes) ??
    toMinutes(b?.config?.duration) ??
    toMinutes(b?.config?.review?.timeLimit) ??
    null;

  // if caller sends raw seconds, accept too
  const bodySeconds = Number(
    b.total_time_seconds ?? b?.config?.total_time_seconds
  );
  const total_time_seconds =
    minutes != null && minutes > 0
      ? minutes * 60
      : Number.isFinite(bodySeconds) && bodySeconds > 0
      ? Math.floor(bodySeconds)
      : null; // NULL means "no limit" at insert time

  const candidateRef = String(
    b.candidateId ?? (Array.isArray(b.candidateIds) ? b.candidateIds[0] : "")
  ).trim();

  const topic = String(b.topic ?? b?.config?.topic ?? "").trim();

  const rawCount = b.count ?? b?.config?.count;
  const count =
    rawCount == null ? null : Math.max(1, Math.min(50, Number(rawCount) || 1));

  // optional difficulty (compat)
  const diffRaw = b.difficulty ?? b?.config?.difficulty;
  const difficulty =
    diffRaw === undefined || diffRaw === null || String(diffRaw).trim() === ""
      ? null
      : String(diffRaw).trim();

  if (!candidateRef || !topic || count == null) {
    return res
      .status(400)
      .json({ error: "Missing required fields (candidateId, topic, count)." });
  }

  const client = await pool.connect();
  let where = "begin";
  try {
    await client.query("BEGIN");

    // A) resolve candidate (id-as-text OR email) -> numeric users.id
    where = "resolve_candidate";
    const cand = await client.query(
      `SELECT id FROM users WHERE id::text = $1 OR email = $1 LIMIT 1`,
      [candidateRef]
    );
    if (!cand.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Candidate not found" });
    }
    const candidateId: number = cand.rows[0].id;

    // B) detect test_id nullability
    where = "introspect_test_id";
    const testIdMeta = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'exam_sessions'
        AND column_name  = 'test_id'
    `);
    const testIdIsNotNull = (testIdMeta.rows[0]?.is_nullable ?? "YES") === "NO";

    // C) resolve/create tests(topic) -> testId (always try)
    let testId: number | null = null;
    where = "maybe_get_or_create_test";
    const testsTable = await client.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'tests'
      ) AS ok
    `);
    const haveTestsTable = !!testsTable.rows[0]?.ok;

    if (haveTestsTable) {
      const found = await client.query(
        `SELECT id FROM tests WHERE LOWER(topic) = LOWER($1) LIMIT 1`,
        [topic]
      );
      if (found.rowCount) {
        testId = found.rows[0].id;
      } else {
        const insTest = await client.query(
          `INSERT INTO tests (topic) VALUES ($1) RETURNING id`,
          [topic]
        );
        testId = insTest.rows[0].id;
      }
    } else if (testIdIsNotNull) {
      await client.query("ROLLBACK");
      return fail(res, 500, "tests_table_missing");
    }

    // D) check available published questions for topic (+ optional difficulty)
    where = "introspect_questions_columns";
    const wanted = [
      "status",
      "is_published",
      "published_at",
      "published_by",
      "topic",
      "difficulty",
    ];
    const colsRes = await client.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'questions'
          AND column_name  = ANY($1::text[])`,
      [wanted]
    );
    const cols = new Map<string, string>();
    for (const r of colsRes.rows) cols.set(r.column_name, r.data_type);

    let publishedPred = "TRUE";
    if (cols.has("status"))
      publishedPred = "LOWER(q.status) IN ('published','approved')";
    else if (cols.has("is_published")) publishedPred = "q.is_published = TRUE";
    else if (cols.has("published_at"))
      publishedPred = "q.published_at IS NOT NULL";
    else if (cols.has("published_by"))
      publishedPred = "q.published_by IS NOT NULL";

    where = "check_available_questions";
    const useTopic = cols.has("topic");

    let availSql = `
      SELECT COUNT(*)::int AS c
      FROM questions q
      WHERE ${publishedPred}
        AND ($1::text IS NULL OR ${
          useTopic ? "LOWER(q.topic) = LOWER($1::text)" : "TRUE"
        })
    `;
    const params: any[] = [topic || null];

    if (difficulty && cols.has("difficulty")) {
      const diffTypeRes = await client.query(
        `SELECT data_type
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name   = 'questions'
            AND column_name  = 'difficulty'
          LIMIT 1`
      );
      const dtype = diffTypeRes.rows[0]?.data_type ?? "";
      const diffIsNumeric = /int|numeric|decimal|real|double/i.test(dtype);

      if (diffIsNumeric) {
        const labelToNum: Record<string, number> = {
          "very easy": 1,
          easy: 2,
          medium: 3,
          hard: 4,
          "very hard": 5,
          "1": 1,
          "2": 2,
          "3": 3,
          "4": 4,
          "5": 5,
        };
        const key =
          difficulty.toLowerCase?.() || String(difficulty).toLowerCase();
        const dnum = labelToNum[key] ?? Number(difficulty);
        availSql += ` AND ($2::int IS NULL OR q.difficulty = $2::int)`;
        params.push(Number.isFinite(dnum) ? dnum : null);
      } else {
        availSql += ` AND ($2::text IS NULL OR LOWER(TRIM(q.difficulty::text)) = LOWER(TRIM($2::text)))`;
        params.push(difficulty);
      }
    }

    const avail = await client.query(availSql, params);
    const available = avail.rows[0]?.c ?? 0;
    if (available < (count ?? 0)) {
      await client.query("ROLLBACK");
      return res.status(422).json({
        error: "Not enough published questions for the selected topic.",
        available,
        requested: count,
      });
    }

    // E) prevent multiple open sessions
    where = "check_open_session";
    if (testId != null) {
      const open = await client.query(
        `SELECT id FROM exam_sessions
         WHERE user_id = $1 AND test_id = $2 AND finished_at IS NULL
         LIMIT 1`,
        [candidateId, testId]
      );
      if (open.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Open session already exists for this candidate & test",
          sessionId: open.rows[0].id,
        });
      }
    } else {
      const open = await client.query(
        `SELECT id FROM exam_sessions
         WHERE user_id = $1 AND finished_at IS NULL
         LIMIT 1`,
        [candidateId]
      );
      if (open.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Open session already exists for this candidate",
          sessionId: open.rows[0].id,
        });
      }
    }

    // F) create the session (typed placeholders everywhere)
    where = "insert_session";
    let ins;
    console.log("[createSessionForCandidate] minutes, total_time_seconds =", {
      allowedTimeMinutes: b?.allowedTimeMinutes,
      config_allowedTimeMinutes: b?.config?.allowedTimeMinutes,
      timeLimitMinutes: b?.timeLimitMinutes,
      timeLimit: b?.timeLimit,
      total_time_seconds, // <- computed number or null
    });

    if (testId != null) {
      ins = await client.query(
        `INSERT INTO exam_sessions
           (user_id, test_id, started_at, total_questions,
            total_time_seconds, time_remaining_seconds, deadline_at, last_event_at)
         VALUES
           ($1, $2, NOW(), $3::int,
            $4::int,
            $4::int,
            CASE WHEN $4 IS NOT NULL
                 THEN NOW() + make_interval(secs => $4::int)
                 ELSE NULL
            END,
            NOW())
         RETURNING id`,
        [candidateId, testId, count, total_time_seconds]
      );
    } else {
      ins = await client.query(
        `INSERT INTO exam_sessions
           (user_id, started_at, total_questions,
            total_time_seconds, time_remaining_seconds, deadline_at, last_event_at)
         VALUES
           ($1, NOW(), $2::int,
            $3::int,
            $3::int,
            CASE WHEN $3 IS NOT NULL
                 THEN NOW() + make_interval(secs => $3::int)
                 ELSE NULL
            END,
            NOW())
         RETURNING id`,
        [candidateId, count, total_time_seconds]
      );
    }

    await client.query("COMMIT");
    return res
      .status(201)
      .json({ sessionId: ins.rows[0].id, testId: testId ?? undefined });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createSessionForCandidate error @", where, ":", err);
    return fail(res, 500, where, err);
  } finally {
    client.release();
  }
};

export const getAssignmentById: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

  const me = req.user;
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  try {
    const q = await pool.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.test_id,
        s.started_at,
        s.finished_at,
        s.total_questions
      FROM exam_sessions s
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (q.rowCount === 0) return res.status(404).json({ error: "Not found" });

    const row = q.rows[0];
    const isStaff = ["admin", "editor", "recruiter"].includes(me.role);
    if (!isStaff && Number(row.user_id) !== Number(me.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(row);
  } catch (err) {
    console.error("getAssignmentById error:", err);
    return res
      .status(500)
      .json({ error: "Failed to get assignment", where: "getAssignmentById" });
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
    console.error("[getMySessionsWithTopic] failed:", err);
    res.status(500).json({ error: "Internal server error" });
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

    // Ownership check
    const own = await pool.query(
      "SELECT 1 FROM exam_sessions WHERE id = $1 AND user_id = $2",
      [sessionId, userId]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "Forbidden" });

    const qsql = `
      SELECT
        sq.position,
        q.id,
        q.question_text,
        q.options,
        q.type,
        q.topic,
        q.difficulty
      FROM session_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.session_id = $1
      ORDER BY sq.position ASC
    `;
    const { rows } = await pool.query(qsql, [sessionId]);

    const out = rows.map((r: any) => ({
      position: Number(r.position),
      questionId: Number(r.id),
      questionText: r.question_text,
      options: r.options, // jsonb array ["A", "B", ...]
      type: r.type ?? "MCQ",
      topic: r.topic ?? null,
      difficulty: Number(r.difficulty ?? 1),
    }));

    res.json(out);
  } catch (err) {
    console.error("[getSessionQuestions] failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateAssignment: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  // Allowed edits
  const body = req.body ?? {};
  const totalQuestions = Number(body.total_questions ?? body.totalQuestions);
  const finishNow = body.finishNow === true;
  const minutes = Number(body.allowedTimeMinutes ?? body.allowed_time_minutes);
  const seconds = Number(body.total_time_seconds);
  const sets: string[] = [];
  const params: any[] = [];

  const newTotalSeconds =
    Number.isFinite(minutes) && minutes > 0
      ? Math.round(minutes * 60)
      : Number.isFinite(seconds) && seconds > 0
      ? Math.floor(seconds)
      : null;

  if (Number.isFinite(totalQuestions) && totalQuestions > 0) {
    sets.push(`total_questions = $${params.length + 1}`);
    params.push(totalQuestions);
  }
  if (newTotalSeconds != null) {
    // set the configured total time
    sets.push(`total_time_seconds = $${params.length + 1}`);
    params.push(newTotalSeconds);
    // if not finished, reset the countdown based on NOW()
    sets.push(
      `time_remaining_seconds = CASE WHEN finished_at IS NULL THEN $${params.length} ELSE time_remaining_seconds END`
    );
    params.push(newTotalSeconds);
    sets.push(
      `deadline_at = CASE WHEN finished_at IS NULL THEN NOW() + ($${params.length} || ' seconds')::interval ELSE deadline_at END`
    );
    params.push(newTotalSeconds);
  }
  if (finishNow) {
    sets.push(`finished_at = NOW()`);
  }

  const sql = `
    UPDATE exam_sessions
    SET ${sets.join(", ")}
    WHERE id = $${params.length + 1}
    RETURNING id, user_id, started_at, finished_at, total_questions
  `;
  params.push(id);

  const client = await pool.connect();
  try {
    const r = await client.query(sql, params);
    if (!r.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json(r.rows[0]);
  } catch (err) {
    console.error("updateAssignment error:", err);
    return res.status(500).json({ error: "Failed to update session" });
  } finally {
    client.release();
  }
};

export const deleteAssignment: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure it exists
    const exists = await client.query(
      `SELECT id FROM exam_sessions WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    // Best-effort dependency cleanup (if FK not ON DELETE CASCADE)
    await client.query(`DELETE FROM answers WHERE session_id = $1`, [id]);

    // Delete the session
    await client.query(`DELETE FROM exam_sessions WHERE id = $1`, [id]);

    await client.query("COMMIT");
    // Return JSON (not 204) so generic fetchers that parse JSON don't choke
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteAssignment error:", err);
    return res.status(500).json({ error: "Failed to delete session" });
  } finally {
    client.release();
  }
};
