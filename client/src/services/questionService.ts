// client/src/services/questionService.ts
import { api } from "../lib/api";
import type { QuestionCreateDTO, QuestionGenerateDTO } from "../types/api";
import type { Question } from "../types/question";
import type { DbQuestionRow } from "../adapters/dbQuestionRow";
import { mapDbRowToQuestion } from "../adapters/dbQuestionRow";

/* ------------------------ Legacy-friendly inputs ------------------------ */
type LegacyCreateInput = {
  topic: string;
  options: string[];
  correct_answer: number;
  difficulty: number | string;
  tags?: string[];
};
type CreateInput = QuestionCreateDTO | LegacyCreateInput;

type LegacyGenerateInput = {
  topic: string;
  count?: number | string;
  numberOfQuestions?: number | string; // legacy alias
  difficulty?: number | string;
};
type GenerateInput = QuestionGenerateDTO | LegacyGenerateInput;

/* --------------------------- List params (topic required) --------------------------- */
export type ListParams = {
  topic: string;
  difficulty?: number | string;
  status?: "pending" | "approved" | "rejected" | "draft" | "archived";
  limit?: number;
  offset?: number;
};

const toDifficultyNum = (d: unknown): number | undefined => {
  if (typeof d === "number" && Number.isFinite(d)) return d;
  if (typeof d === "string") {
    const m: Record<string, number> = {
      "very easy": 1,
      easy: 2,
      medium: 3,
      hard: 4,
      "very hard": 5,
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
    };
    const v = m[d.trim().toLowerCase()];
    if (v) return v;
  }
  return undefined;
};

function buildListQuery(params: ListParams): string {
  const sp = new URLSearchParams();
  const topic = String(params.topic ?? "").trim();
  if (!topic) throw new Error("Topic is required");
  sp.set("topic", topic);
  sp.set(
    "difficulty",
    String(Math.min(5, Math.max(1, toDifficultyNum(params.difficulty) ?? 3)))
  );
  if (params.status) sp.set("status", params.status);
  if (Number.isFinite(params.limit)) sp.set("limit", String(params.limit));
  if (Number.isFinite(params.offset)) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/* --------------------------- Normalizers -> DTO -------------------------- */
function toCreateDTO(input: CreateInput): QuestionCreateDTO {
  if ("question_text" in input) {
    const dto = input as QuestionCreateDTO;
    return {
      question_text: String(dto.question_text),
      options: (dto.options ?? []).map(String),
      correct_answer: Number(dto.correct_answer),
      difficulty: Number(dto.difficulty),
      //tags: Array.isArray(dto.tags) ? dto.tags.map(String) : undefined,
    };
  }
  const legacy = input as LegacyCreateInput;
  const options = (legacy.options ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);

  let correct = Number(legacy.correct_answer ?? 0);
  if (!Number.isFinite(correct) || correct < 0 || correct >= options.length) {
    correct = 0;
  }

  return {
    question_text: String(legacy.topic ?? "").trim(),
    options,
    correct_answer: correct,
    difficulty: toDifficultyNum(legacy.difficulty) ?? 3,
    //tags: Array.isArray(legacy.tags) ? legacy.tags.map(String) : undefined,
  };
}

/** STRICT to BE schema: body must be { topic, difficulty:1..5, count:1..50 } */
function toGenerateDTO(input: GenerateInput): QuestionGenerateDTO {
  const topic = String((input as any).topic ?? "").trim();
  if (topic.length < 2) throw new Error("Topic must be at least 2 characters");

  const diffNum = Math.min(
    5,
    Math.max(1, toDifficultyNum((input as any).difficulty) ?? 3)
  );

  const countRaw =
    (input as any).count ?? (input as any).numberOfQuestions ?? 5;
  const countNum = Math.min(50, Math.max(1, Number(countRaw) || 5));

  // IMPORTANT: only these three keys; no tags or extras to avoid Zod invalid_union
  const dto: QuestionGenerateDTO = {
    topic,
    difficulty: diffNum,
    count: countNum,
  };
  return dto;
}

/* ------------------------------ Public API ------------------------------ */

export async function getQuestions(params: ListParams): Promise<Question[]> {
  const url = `/questions${buildListQuery(params)}`;
  const data = await api.get<DbQuestionRow[] | { items: DbQuestionRow[] }>(url);
  const rows = Array.isArray(data) ? data : data?.items ?? [];
  return rows.map(mapDbRowToQuestion);
}

/** Create requires topic in query (?topic=...) — unchanged */
export type CreateQuestionPayload = {
  question_text: string;
  options: string[];
  correct_answer: number;                 // 0-based
  difficulty: 1 | 2 | 3 | 4 | 5;         // number enum you already use
  topic: string;
  tags?: string[];
  type?: "MCQ" | "Short Answer" | "Essay";
  status?: "draft" | "published" | "archived";
};

export async function createQuestion(body: CreateQuestionPayload) {
  // IMPORTANT: no query params here
  return api.post("/questions", body);
}

/** Generate — strict body per BE Zod (no guessing, no extra props) */
// client/src/services/questionService.ts
export function generateQuestions(input: {
  topic: string;
  difficulty?: number | string;
  count?: number | string;
}) {
  const topic = String(input.topic ?? "").trim();
  if (topic.length < 2) throw new Error("Topic must be at least 2 characters");

  const toNum = (v: unknown, def: number, lo: number, hi: number) => {
    const n = typeof v === "number" ? v : Number(v);
    const x = Number.isFinite(n) ? n : def;
    return Math.min(hi, Math.max(lo, x));
  };

  const difficulty = toNum(input.difficulty, 3, 1, 5);
  const count = toNum(input.count, 5, 1, 50);

  // IMPORTANT: body only; NO query params here
  const body = { topic, difficulty, count };
  return api.post("/questions/generate", body);
}

export async function updateQuestionStatus(
  id: number,
  status: "pending" | "approved" | "rejected" | "draft" | "archived"
): Promise<Question> {
  const row = await api.patch<DbQuestionRow>(`/publish/${id}`, { status });
  return mapDbRowToQuestion(row);
}

export async function removeQuestion(id: number): Promise<void> {
  await api.del<void>(`/questions/${id}?hard=true`);
}
