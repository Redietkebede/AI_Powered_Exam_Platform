import { MCQ } from "../services/examStructure";

function norm(s: string) {
  return String(s).toLowerCase().replace(/\s+/g, " ").replace(/[`"'.,()[\]]/g, "").trim();
}

function extractCorrectIndex(raw: any): number {
  let n = Number(raw.correct_answer);
  if (!Number.isNaN(n)) {
    if (n >= 1 && n <= 4) return n - 1;
    return n;
  }

  const ans = String(raw.correct_answer ?? "").trim();

  // A/B/C/D
  if (/^[A-D]$/i.test(ans)) return ans.toUpperCase().charCodeAt(0) - 65;

  // Match by text
  const i = raw.options?.findIndex((o: string) => norm(o) === norm(ans));
  return i ?? -1;
}

export function validateQuestion(q: any): MCQ | null {
  if (!q?.options || !Array.isArray(q.options) || q.options.length !== 4) {
    console.warn("✗ Invalid options array", q);
    return null;
  }
  if (!q.question_text || String(q.question_text).trim().length < 5) {
    console.warn("✗ Invalid question text", q);
    return null;
  }

  const correctIndex = extractCorrectIndex(q);
  if (correctIndex < 0 || correctIndex >= q.options.length) {
    console.warn("✗ Unable to map correct_answer to an index", {
      ans: q.correct_answer,
      options: q.options,
      q: q.question_text,
    });
    return null;
  }

  return {
    question_text: String(q.question_text).trim(),
    options: q.options.map(String),
    correct_answer: correctIndex,
    explanation: q.explanation ? String(q.explanation) : null,
    tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
    difficulty: Number(q.difficulty) || 3,
  };
}

// from validateQuestion.ts output -> create payload
export function toCreateFromValidated(m: {
  question_text: string; options: string[]; correct_answer: number; difficulty: number; tags?: string[];
}) {
  return {
    question_text: m.question_text,
    options: m.options,
    correctIndex: m.correct_answer,
    difficulty: m.difficulty,
    tags: m.tags ?? [],
  };
}
