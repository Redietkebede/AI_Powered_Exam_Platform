import pool from "../config/db";
import { Question } from "../middleware/qustions";

export async function insertQuestion(q: Question) {
  return pool.query(
    `INSERT INTO questions (topic, difficulty, question_text, options, correct_answer, explanation, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [q.topic, q.difficulty, q.question_text, JSON.stringify(q.options), q.correct_answer, q.explanation, JSON.stringify(q.tags)]
  );
}
