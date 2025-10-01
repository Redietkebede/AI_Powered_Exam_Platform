import pool from "../config/db";

export type Question = {
  id: string;
  topic: string;
  difficulty: number;
  question_text: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
  tags: string[];
  created_at: string;
};

// keep the same exported type if you already have one
export type InsertQuestion = {
  topic: string;
  question_text: string;
  options: string[]; // exactly 4
  correct_answer: number; // 0..3
  difficulty: number; // 1..5
  tags?: string[]; // text[]
  explanation?: string[] | null; // text[] | null
  status?: string; // optional
  type?: string; // optional
};

export async function insertQuestion(row: InsertQuestion) {
  const tagsArr: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
  const explArr: string[] | null =
    row.explanation == null ? null : row.explanation.map(String);

  // inside insertQuestion(...)
  const sql = `
  INSERT INTO questions
    (topic, question_text, options, correct_answer, difficulty, tags, explanation, status, type)
  VALUES
    ($1,    $2,           $3::jsonb, $4,            $5,         $6::text[], $7::text[], COALESCE($8,'draft'), COALESCE($9,'MCQ'))
  ON CONFLICT ON CONSTRAINT questions_topic_question_text_key DO NOTHING
  RETURNING id
`;

  const params = [
    row.topic,
    row.question_text,
    JSON.stringify(row.options),
    row.correct_answer,
    row.difficulty,
    Array.isArray(row.tags) ? row.tags.map(String) : [],
    row.explanation == null ? null : row.explanation.map(String),
    row.status ?? "draft",
    row.type ?? "MCQ",
  ];

  const { rows } = await pool.query(sql, params);
  // rows.length === 0 => duplicate skipped
  return rows[0]?.id ?? null;
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
