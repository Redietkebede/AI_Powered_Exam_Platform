import { number, z } from "zod";
import { RequestHandler } from "express";
import { generateQuestions } from "../services/examStructure";
import { insertQuestion, getQuestions } from "../config/qustionsMiddleware";
import pool from "../config/db";
const ReqSchema = z
  .object({
    topic: z.string().min(2, "topic is required"),
    difficulty: z.coerce.number().int().min(1).max(5).default(3),
    count: z.coerce.number().int().min(1).max(50).default(5),
  })
  .or(
    // backwards-compat: allow { topic, difficulty, numberOfQuestions }
    z
      .object({
        topic: z.string().min(2),
        difficulty: z.coerce.number().int().min(1).max(5).default(3),
        numberOfQuestions: z.coerce.number().int().min(1).max(50).default(5),
      })
      .transform((v) => ({
        topic: v.topic,
        difficulty: v.difficulty,
        count: v.numberOfQuestions,
      }))
  );

const PublishSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  action: z.enum(["publish", "unpublish"]).default("publish"),
});
const DeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  hard: z.coerce.boolean().optional().default(false),
});

export const createQuestions: RequestHandler = async (req, res) => {
  try {
    const { topic, difficulty, count } = ReqSchema.parse(req.body);

    const payload = await generateQuestions(
      topic,
      difficulty as 1 | 2 | 3 | 4 | 5,
      count,
    );

    // WRITE model: match exactly what insertMany expects
    type InsertQuestionRow = {
      topic: string;
      question_text: string;
      options: string[]; // stored/serialized by DB layer
      correct_answer: number; // 0..3
      difficulty: number; // 1..5
      tags?: string[]; // optional
      explanation?: string[] | null; // <-- match DB: array or null
    };

    const notNull = <T>(x: T | null | undefined): x is T => x != null;
    const norm = (s: unknown) =>
      String(s ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    const rows: (InsertQuestionRow | null)[] = (payload?.questions ?? []).map(
      (q: any) => {
        // options as string[]
        const opts: string[] = Array.isArray(q?.options)
          ? (q.options as unknown[]).slice(0, 4).map((s: any) => String(s))
          : [];

        // must be exactly 4 options
        if (opts.length !== 4) {
          console.warn("✗ Skipping (needs 4 options):", q?.question_text);
          return null;
        }

        // resolve correct index (prefer normalized numeric; then 0-based/1-based; then text match)
        let idx: number =
          typeof q?.correct_answer === "number" ? q.correct_answer : -1;

        if (idx < 0 || idx >= opts.length) {
          const ai = Number(q?.answerIndex);
          if (!Number.isNaN(ai) && ai >= 0 && ai < opts.length) idx = ai;
          else if (!Number.isNaN(ai) && ai >= 1 && ai <= opts.length)
            idx = ai - 1;
        }

        if (idx < 0 || idx >= opts.length) {
          const ansText = norm(q?.correct_answer ?? q?.answer ?? q?.answerText);
          if (ansText) {
            idx = opts.findIndex((o: string) => norm(o) === ansText);
          }
        }

        if (idx < 0 || idx >= opts.length) {
          console.warn("✗ Could not resolve correct_answer:", q?.question_text);
          return null;
        }

        // explanation must be string[] | null for insertMany
        const explanation: string[] | null = Array.isArray(q?.explanation)
          ? (q.explanation as unknown[]).map((s: any) => String(s))
          : typeof q?.explanation === "string" && q.explanation.trim() !== ""
          ? [q.explanation]
          : null;

        // tags -> string[]
        const tags: string[] = Array.isArray(q?.tags)
          ? (q.tags as unknown[]).map((t: any) => String(t))
          : typeof q?.tags === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(q.tags);
                return Array.isArray(parsed) ? parsed.map(String) : [];
              } catch {
                return [];
              }
            })()
          : [];

        return {
          topic: String(payload?.topic ?? topic),
          question_text: String(q?.question_text ?? q?.question ?? "").trim(),
          options: opts,
          correct_answer: idx,
          difficulty: Number(payload?.difficulty ?? difficulty) || 3,
          tags,
          explanation, // <-- rename to `explanation` here if your DB expects that
        };
      }
    );

    const cleanRows: InsertQuestionRow[] = rows.filter(notNull);

    if (cleanRows.length === 0) {
      return res.status(422).json({ error: "No valid questions to insert." });
    }

    await insertMany(cleanRows);

    return res.json({
      inserted: cleanRows.length,
      topic: payload?.topic ?? topic,
      difficulty: payload?.difficulty ?? difficulty,
      generation_time: payload?.generation_time,
    });
  } catch (err: any) {
    if (res.headersSent) return;
    const status = Number(err?.status) || 400;
    const details = err?.issues ?? err?.message ?? String(err);
    console.error("[GEN] failed:", details);
    return res.status(status).json({ error: "failed to generate", details });
  }
};

export const listQuestions: RequestHandler = async (req, res) => {
  try {
    const topic = String(req.query.topic ?? "");
    const difficulty = Number(req.query.difficulty ?? 3);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const rows = await getQuestions(topic, difficulty, limit, offset);
    res.json({ total: rows.length, items: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Failed to fetch questions" });
  }
};

export async function insertMany(
  questions: Parameters<typeof insertQuestion>[0][]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const q of questions) {
      await client.query(
        `
        INSERT INTO questions
          (topic, question_text, options, correct_answer, difficulty, tags, explanation, status)
        VALUES
          ($1,    $2,            $3::jsonb, $4,            $5,         $6::text[], $7, 'draft')
        ON CONFLICT (topic, question_text) DO NOTHING
        `,
        [
          q.topic, // $1
          q.question_text, // $2
          JSON.stringify(q.options), // $3 -> jsonb (no stringify)
          q.correct_answer, // $4
          q.difficulty, // $5
          Array.isArray(q.tags) ? q.tags : [], // $6 -> text[]
          q.explanation ?? null, // $7 -> explanation
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export const publishQuestion: RequestHandler = async (req, res) => {
  try {
    const { ids, action } = PublishSchema.parse(req.body);
    const userId = req.user!.id; // set by verifyToken

    const { rows } = await pool.query(
      `
      UPDATE questions
         SET status = CASE WHEN $2 = 'publish' THEN 'published' ELSE 'draft' END,
             published_at = CASE WHEN $2 = 'publish' THEN NOW() ELSE NULL END,
             published_by = CASE WHEN $2 = 'publish' THEN $3 ELSE NULL END
       WHERE id = ANY($1::int[])
         AND deleted_at IS NULL
      RETURNING id, status, published_at, published_by;
      `,
      [ids, action, userId]
    );

    return res.json({
      updated: rows.length,
      action,
      items: rows,
    });
  } catch (err: any) {
    const details = err?.issues ?? err?.message ?? String(err);
    return res.status(400).json({ error: "failed to publish", details });
  }
};
export const deleteQuestion: RequestHandler = async (req, res) => {
  try {
    const { ids, hard } = DeleteSchema.parse(req.body);

    if (hard) {
      const { rows } = await pool.query(
        `DELETE FROM questions WHERE id = ANY($1::int[]) RETURNING id;`,
        [ids]
      );
      return res.json({
        deleted: rows.length,
        ids: rows.map((r) => r.id),
        hard: true,
      });
    }

    const { rows } = await pool.query(
      `UPDATE questions SET deleted_at = NOW()
        WHERE id = ANY($1::int[]) AND deleted_at IS NULL
        RETURNING id;`,
      [ids]
    );
    return res.json({
      deleted: rows.length,
      ids: rows.map((r) => r.id),
      hard: false,
    });
  } catch (err: any) {
    const details = err?.issues ?? err?.message ?? String(err);
    return res.status(400).json({ error: "failed to delete", details });
  }
};

export const deleteQuestionById: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE questions SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL;`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "not found" });
    return res.json({ deleted: 1, id, hard: false });
  } catch (e: any) {
    return res
      .status(500)
      .json({ error: "failed to delete", details: e.message });
  }
};
