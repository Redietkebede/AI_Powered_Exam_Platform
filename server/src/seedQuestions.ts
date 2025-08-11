import "dotenv/config";
import pool from "./config/db"; // adjust path if yours is different

type ChoiceMap = { A: string; B: string; C: string; D: string };
type SeedQuestion = {
  topic: string;
  question_text: string;
  options: ChoiceMap;
  correct_answer: "A" | "B" | "C" | "D";
  tags: string[];
  difficulty: number; // 1..5
  elo_rating?: number | null;
};

const seeds: SeedQuestion[] = [
  {
    topic: "math",
    question_text: "2 + 2 = ?",
    options: { A: "3", B: "4", C: "5", D: "6" },
    correct_answer: "B",
    tags: ["math"],
    difficulty: 1,
  },
  {
    topic: "math",
    question_text: "5 * 3 = ?",
    options: { A: "15", B: "10", C: "8", D: "12" },
    correct_answer: "A",
    tags: ["math"],
    difficulty: 2,
  },
  {
    topic: "math",
    question_text: "12 / 3 = ?",
    options: { A: "5", B: "3", C: "4", D: "6" },
    correct_answer: "C",
    tags: ["math"],
    difficulty: 3,
  },
  {
    topic: "math",
    question_text: "sqrt(81) = ?",
    options: { A: "8", B: "9", C: "7", D: "6" },
    correct_answer: "B",
    tags: ["math"],
    difficulty: 4,
  },
  {
    topic: "math",
    question_text: "Prime after 13?",
    options: { A: "15", B: "17", C: "19", D: "21" },
    correct_answer: "B",
    tags: ["math"],
    difficulty: 5,
  },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected to DB");

    await client.query("BEGIN");

    // ensure reseeding is safe
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_text_diff
      ON questions (question_text, difficulty)
    `);

    for (const q of seeds) {
      await client.query(
        `INSERT INTO questions (topic, question_text, options, correct_answer, difficulty, tags, elo_rating)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
         ON CONFLICT (question_text, difficulty) DO NOTHING`,
        [
          q.topic,
          q.question_text,
          JSON.stringify(q.options),
          q.correct_answer,
          q.difficulty,
          q.tags,
          q.elo_rating ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    console.log("✅ Seeded questions");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
