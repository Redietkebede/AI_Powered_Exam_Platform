import type { Question } from "../types/question";

// DB row returned by /api/questions
export type DbQuestionRow = {
  id: number;
  topic: string | null;
  question_text: string;
  options: (string | { text: string })[];
  correct_answer: number;
  difficulty: number | null;            // 1..5 or null
  tags: string[] | null;
  status: "draft" | "published" | "archived";
  explanation?: string[] | null;
  created_at?: string | null;
  published_at?: string | null;
};

function numToLabel(n?: number | null): Question["difficulty"] {
  switch (n) {
    case 1: return "Very Easy";
    case 2: return "Easy";
    case 3: return "Medium";
    case 4: return "Hard";
    case 5: return "Very Hard";
    default: return "Medium";
  }
}

function normalizeOptions(raw: DbQuestionRow["options"]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: any) => (typeof o === "string" ? o : String(o?.text ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

function inRange(i: number, len: number) {
  return Number.isInteger(i) && i >= 0 && i < len;
}

export function mapDbRowToQuestion(row: DbQuestionRow): Question {
  const options = normalizeOptions(row.options);
  const idx = inRange(row.correct_answer, options.length) ? row.correct_answer : 0;

  const status: Question["status"] =
    row.status === "published" ? "approved"
    : row.status === "archived" ? "rejected"
    : "draft";

  const q: Question = {
    id: row.id,
    text: row.question_text,
    question_text: row.question_text,      // legacy alias
    options,
    choices: options,             // alias
    correctIndex: idx,
    answer: options[idx] ?? "",
    difficulty: numToLabel(row.difficulty ?? 3),
    numericDifficulty: row.difficulty ?? 3,
    type: "MCQ",
    status,
    tags: row.tags ?? [],
    topic: row.topic ?? undefined,
    createdAt: row.created_at ?? undefined,
  };

  return q;
}
