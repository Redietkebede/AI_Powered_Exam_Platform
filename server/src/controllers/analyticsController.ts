// server/src/controllers/analyticsController.ts
import { Request, Response } from "express";
import  pool from "../config/db";

/** Utility: normalize difficulty value to label */
function normDiffLabel(x: unknown):
  | "Very Easy"
  | "Easy"
  | "Medium"
  | "Hard"
  | "Very Hard" {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "very easy" || s === "very_easy" || s === "1") return "Very Easy";
  if (s === "easy" || s === "2") return "Easy";
  if (s === "medium" || s === "3") return "Medium";
  if (s === "hard" || s === "4") return "Hard";
  return "Very Hard";
}

/** Utility: discover a “published” predicate for questions table */
async function getQuestionsPublishedPredicate(): Promise<string> {
  const cols = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'questions'
        AND column_name  IN ('status','is_published','published_at','published_by')`
  );
  const names = new Set(cols.rows.map((r) => r.column_name));
  if (names.has("status")) return "LOWER(status) IN ('published','approved')";
  if (names.has("is_published")) return "is_published = TRUE";
  if (names.has("published_at")) return "published_at IS NOT NULL";
  if (names.has("published_by")) return "published_by IS NOT NULL";
  return "TRUE";
}

/**
 * GET /api/analytics/overview
 * Optional filters: ?candidateId=..&topic=..&difficulty=..
 * Returns the exact shape your FE expects.
 */
export async function getOverview(req: Request, res: Response) {
  const { candidateId, topic, difficulty } = req.query as {
    candidateId?: string;
    topic?: string;
    difficulty?: string;
  };

  const params: any[] = [];
  const clauses: string[] = [];

  if (candidateId) {
    clauses.push(`s.user_id = $${params.length + 1}`);
    params.push(Number(candidateId));
  }
  if (topic) {
    clauses.push(`LOWER(t.topic) = LOWER($${params.length + 1})`);
    params.push(String(topic));
  }
  if (difficulty) {
    clauses.push(`LOWER(q.difficulty::text) = LOWER($${params.length + 1})`);
    params.push(String(difficulty));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    // --- KPIs ---
    const [candQ, sessQ, qCountQ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE LOWER(role)='candidate'`
      ),
      pool.query(`SELECT COUNT(*)::int AS c FROM exam_sessions`),
      (async () => {
        const pred = await getQuestionsPublishedPredicate();
        return pool.query(`SELECT COUNT(*)::int AS c FROM questions WHERE ${pred}`);
      })(),
    ]);

    // avg score across finished sessions
    // prefer completions if you have one; else compute from answers
    let avgScore = 0;
    try {
      const comp = await pool.query(
        `SELECT COALESCE(AVG(score)::float,0) AS s FROM completions`
      );
      avgScore = Number(comp.rows[0]?.s || 0);
    } catch {
      const calc = await pool.query(`
        WITH fs AS (
          SELECT id FROM exam_sessions WHERE finished_at IS NOT NULL
        ),
        agg AS (
          SELECT a.session_id,
                 SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::int AS correct,
                 COUNT(*)::int AS total
          FROM exam_answers a
          JOIN fs ON fs.id = a.session_id
          GROUP BY a.session_id
        )
        SELECT COALESCE(AVG(100.0 * correct / NULLIF(total,0)),0) AS s FROM agg
      `);
      avgScore = Number(calc.rows[0]?.s || 0);
    }

    const candidates = candQ.rows[0].c;
    const examsTaken = sessQ.rows[0].c;
    const questions = qCountQ.rows[0].c;

    // --- Performance over time (from finished sessions) ---
    const perf = await pool.query(
      `
      SELECT s.finished_at AS completed_at,
             COALESCE(CASE
               WHEN a.total > 0 THEN ROUND(100.0 * a.correct / a.total)
               ELSE NULL
             END, 0)::int AS score
      FROM exam_sessions s
      LEFT JOIN tests t ON t.id = s.test_id
      LEFT JOIN (
        SELECT session_id,
               SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::int AS correct,
               COUNT(*)::int AS total
        FROM exam_answers
        GROUP BY session_id
      ) a ON a.session_id = s.id
      ${where}
      AND s.finished_at IS NOT NULL
      ORDER BY s.finished_at ASC
      `,
      params
    );

    const performanceOverTime = perf.rows.map((r) => ({
      label: new Date(r.completed_at).toLocaleDateString(),
      score: Number(r.score || 0),
    }));

    // --- Scores by difficulty ---
    const diff = await pool.query(
      `
      SELECT q.difficulty, a.is_correct
      FROM exam_answers a
      JOIN exam_sessions s ON s.id = a.session_id
      LEFT JOIN tests t ON t.id = s.test_id
      JOIN questions q ON q.id = a.question_id
      ${where}
      `,
      params
    );

    const diffBuckets = new Map<
      "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard",
      { c: number; t: number }
    >([
      ["Very Easy", { c: 0, t: 0 }],
      ["Easy", { c: 0, t: 0 }],
      ["Medium", { c: 0, t: 0 }],
      ["Hard", { c: 0, t: 0 }],
      ["Very Hard", { c: 0, t: 0 }],
    ]);

    for (const row of diff.rows) {
      const key = normDiffLabel(row.difficulty);
      const b = diffBuckets.get(key)!;
      b.t += 1;
      if (row.is_correct) b.c += 1;
    }

    const scoresByDifficulty = ([
      "Very Easy",
      "Easy",
      "Medium",
      "Hard",
      "Very Hard",
    ] as const).map((k) => {
      const b = diffBuckets.get(k)!;
      return {
        difficulty: k,
        accuracy_pct: b.t > 0 ? Math.round((100 * b.c) / b.t) : 0,
      };
    });

    // --- Topic insights ---
    const topics = await pool.query(
      `
      SELECT COALESCE(t.topic,'General') AS topic,
             SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::int AS correct,
             COUNT(*)::int AS total
      FROM exam_answers a
      JOIN exam_sessions s ON s.id = a.session_id
      LEFT JOIN tests t ON t.id = s.test_id
      JOIN questions q ON q.id = a.question_id
      ${where}
      GROUP BY COALESCE(t.topic,'General')
      ORDER BY 1
      `,
      params
    );

    const topicInsights = topics.rows.map((r) => ({
      topic: r.topic as string,
      accuracy_pct:
        Number(r.total) > 0
          ? Math.round((100 * Number(r.correct)) / Number(r.total))
          : 0,
    }));

    // --- Time spent distribution (histogram buckets, seconds) ---
    const times = await pool.query(
      `
      SELECT GREATEST(1, a.time_taken_seconds)::int AS secs
      FROM exam_answers a
      JOIN exam_sessions s ON s.id = a.session_id
      LEFT JOIN tests t ON t.id = s.test_id
      ${where}
      `,
      params
    );

    // Return simple bucket counts that your FE can plot directly
    // Buckets: ≤30s, 31–60s, 61–90s, 91–120s, 120s+
    const buckets = [0, 0, 0, 0, 0];
    for (const r of times.rows) {
      const s = Number(r.secs || 0);
      if (s <= 30) buckets[0] += 1;
      else if (s <= 60) buckets[1] += 1;
      else if (s <= 90) buckets[2] += 1;
      else if (s <= 120) buckets[3] += 1;
      else buckets[4] += 1;
    }

    return res.json({
      candidates,
      examsTaken,
      avgScore: Math.round(avgScore),
      questions,
      performanceOverTime,
      scoresByDifficulty,
      topicInsights,
      timeSpentSeconds: buckets, // histogram counts by bucket
    });
  } catch (e) {
    console.error("[analytics/overview] error:", e);
    return res.status(500).json({ error: "analytics_overview_failed" });
  }
}
