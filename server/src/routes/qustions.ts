import pool from "../config/db";
import { Question } from "../config/qustionsMiddleware";

export async function insertQuestion(q: Question) {
  return pool.query(
    `INSERT INTO questions (topic, difficulty, stem, choices, answer_index, explanation, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [q.topic, q.difficulty, q.stem, JSON.stringify(q.choices), q.answer_index, q.explanation, JSON.stringify(q.tags)]
  );
}
