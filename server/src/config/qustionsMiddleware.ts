// src/db/questions.ts
import pool from "./db";

export type Question = {
  id: string;
  topic: string;
  difficulty: number;
  stem: string;
  choices: string[];
  answer_index: number;
  explanation: string;
  tags: string[] | null;
  source: string;
  created_at: string;
};

export async function insertQuestion(q: {
  topic: string; difficulty: number; stem: string;
  choices: string[]; answerIndex: number; explanation: string; tags?: string[];
  source?: string;
}) {
  const sql = `
    INSERT INTO questions (topic,difficulty,stem,choices,answer_index,explanation,tags,source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (topic, stem) DO NOTHING
    RETURNING *;
  `;
  const vals = [
    q.topic, q.difficulty, q.stem, JSON.stringify(q.choices),
    q.answerIndex, q.explanation, JSON.stringify(q.tags ?? []), q.source ?? "llm",
  ];
  const { rows } = await pool.query(sql, vals);
  return rows[0] as Question | undefined;
}

export async function getQuestions(topic: string, difficulty: number, limit = 20, offset = 0) {
  const sql = `
    SELECT * FROM questions
    WHERE topic = $1 AND difficulty = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4
  `;
  const { rows } = await pool.query(sql, [topic, difficulty, limit, offset]);
  return rows;
}
