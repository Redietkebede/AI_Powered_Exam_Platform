import { z } from "zod";
import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { generateQuestions } from "../services/examStructure";
import { insertQuestion, getQuestions } from "../config/qustionsMiddleware";
import pool from "../config/db";

const ReqSchema = z.object({
  topic: z.string().min(3),
  difficulty: z.number().int().min(1).max(5),
  count: z.number().int().min(1).max(50).default(5),
});

export async function createQuestions(req: AuthRequest, res: Response) {
  try {
    const { topic, difficulty, count } = ReqSchema.parse(req.body);

    const payload = await generateQuestions(
      topic,
      difficulty as 1 | 2 | 3 | 4 | 5,
      count
    );

    // Bulk insert in one transaction
    await insertMany(
      payload.questions.map((q) => ({
        topic: payload.topic,
        difficulty: payload.difficulty,
        stem: q.stem,
        choices: q.choices,
        answerIndex: q.answerIndex,
        explanation: q.explanation,
        tags: q.tags ?? [],
        source: "llm",
      }))
    );

    res.json({ inserted: payload.questions.length, topic, difficulty });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "failed to generate" });
  }
}

export async function listQuestions(req: AuthRequest, res: Response) {
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
}


export async function insertMany(
  questions: Parameters<typeof insertQuestion>[0][]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const q of questions) {
      await client.query(
        `INSERT INTO questions (topic,difficulty,stem,choices,answer_index,explanation,tags,source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (topic, stem) DO NOTHING`,
        [
          q.topic,
          q.difficulty,
          q.stem,
          JSON.stringify(q.choices),
          q.answerIndex,
          q.explanation,
          JSON.stringify(q.tags ?? []),
          "llm",
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
