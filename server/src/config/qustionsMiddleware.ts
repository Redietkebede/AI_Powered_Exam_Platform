// src/db/questions.ts
import pool from "./db";

export type Question = {
  id: string;
  topic: string;
  difficulty: number;
  question_text: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  tags: string[] | null;
  created_at: string;
};

export async function insertQuestion(q: {
  topic: string;
  question_text: string;
  options: string[];                     // 4 choices
  correct_answer: "A" | "B" | "C" | "D"; // char(1)
  difficulty: number;
  tags?: string[];
  explanation?: string[];               // only if you added this column
}) {
  const sql = `
    INSERT INTO questions
      (topic, question_text, options, correct_answer, difficulty, tags, status)
    VALUES
      ($1,    $2,            $3::jsonb, $4,            $5,         $6::text[], 'draft')
    ON CONFLICT (topic, question_text) DO NOTHING
    RETURNING *;
  `;
  const vals = [
    q.topic,                 // $1
    q.question_text,         // $2
    q.options,               // $3 -> jsonb (no stringify)
    q.correct_answer,        // $4 -> 'A'|'B'|'C'|'D'
    q.difficulty,            // $5
    Array.isArray(q.tags) ? q.tags : [], // $6 -> text[]
  ];
  const { rows } = await pool.query(sql, vals);
  return rows[0] as Question | undefined;
}


export async function getQuestions(
  topic: string,
  difficulty: number,
  limit = 20,
  offset = 0
) {
  const sql = `
    SELECT * FROM questions
    WHERE topic = $1 AND difficulty = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4
  `;
  const { rows } = await pool.query(sql, [topic, difficulty, limit, offset]);
  return rows;
}
