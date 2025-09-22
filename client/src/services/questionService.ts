import { request } from "../lib/api";
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

/* --------------------------- List params (topic OPTIONAL) --------------------------- */
export type ListParams = {
  /** e.g. 'published' | 'draft' | 'archived' | UI 'approved' (mapped to 'published') */
  status?: string;
  /** Prefer 'topic'; omitted from query if '' */
  topic?: string;
  /** Fallback if the UI supplies 'subject' instead of 'topic' */
  subject?: string;
  /** Optional difficulty filter (accepts label or 1..5); omitted if empty */
  difficulty?: string | number;
  /** Pagination (optional) */
  limit?: number;
  offset?: number;
  /** Optional text search (if supported by BE) */
  search?: string;
  /** Optional creator filter (if supported) */
  createdBy?: number | string;
};

/* ------------------------------ Normalizers ------------------------------ */
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

const normalizeStatus = (s?: string): string | undefined => {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "approved") return "published"; // UI → DB
  return t;
};

/** Build a query string, skipping empty/whitespace-only params. */
function buildListQuery(params: ListParams = {}): string {
  const sp = new URLSearchParams();

  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    sp.set(k, s);
  };

  // topic OR subject (prefer topic)
  const topic = String(params.topic ?? "").trim();
  const subject = String(params.subject ?? "").trim();
  if (topic) sp.set("topic", topic);
  else if (subject) sp.set("topic", subject);

  // status (normalized); do not silently inject here—caller decides default
  const st = normalizeStatus(params.status);
  if (st) sp.set("status", st);

  // difficulty (optional) — accept label or numeric 1..5, pass as normalized number
  if (params.difficulty !== undefined && params.difficulty !== null) {
    const dnum = toDifficultyNum(params.difficulty);
    if (dnum) sp.set("difficulty", String(Math.min(5, Math.max(1, dnum))));
    else add("difficulty", params.difficulty);
  }

  // pagination
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    sp.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number" && Number.isFinite(params.offset)) {
    sp.set("offset", String(params.offset));
  }

  // optional search / createdBy
  add("q", params.search);
  add("createdBy", params.createdBy);

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

  const dto: QuestionGenerateDTO = {
    topic,
    difficulty: diffNum,
    count: countNum,
  };
  return dto;
}

/** When you want counts in other places */
export type TopicAvailability = {
  topic: string;
  available: number;
};

/**
 * Returns just topic names (what the chips expect).
 * Backs onto GET /api/questions/topics which returns [{topic, available}].
 */
export async function getTopics(): Promise<string[]> {
  const rows = await api.get<TopicAvailability[]>("/questions/topics");
  return rows.map((r) => r.topic);
}

/** Optional: used by the “Available questions” counter */
export async function countPublishedForTopic(
  topic: string,
  type: string = "MCQ"
): Promise<number> {
  const t = encodeURIComponent(String(topic ?? "").trim());
  const ty = encodeURIComponent(type);
  const res = await request<{ topic: string; type: string; available: number }>(
    `/questions/available?topic=${t}&type=${ty}`
  );
  return res.available ?? 0;
}

/** Optional: if any admin screen wants the counts too */
export async function getPublishedTopics(): Promise<TopicAvailability[]> {
  return await request<TopicAvailability[]>("/questions/topics");
}

/* ------------------------------ Public API ------------------------------ */

/**
 * If a topic is provided -> call `/questions?...`
 * If no topic            -> call `/questions/published?...` when status is (or defaults to) published
 *
 * Key fix:
 *  - Normalize status ('approved' -> 'published'), default to 'published' when omitted.
 *  - Use the normalized status for choosing the endpoint.
 *  - Accept difficulty labels and map to 1..5.
 *  - Tolerate array | {items} | {rows} response shapes.
 */
export async function getQuestions(
  params: ListParams = {}
): Promise<Question[]> {
  // Normalize status once, and default to 'published' for Assignment use-case
  const normalizedStatus = normalizeStatus(params.status) ?? "published";

  // Build query string with the normalized status
  const qs = buildListQuery({ ...params, status: normalizedStatus });

  // Choose endpoint using the normalized status
  const base =
    normalizedStatus === "published" ? "/questions/published" : "/questions";

  const data = await api.get<
    DbQuestionRow[] | { items: DbQuestionRow[] } | { rows: DbQuestionRow[] }
  >(`${base}${qs}`);

  const rows: DbQuestionRow[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.items)
    ? (data as any).items
    : Array.isArray((data as any)?.rows)
    ? (data as any).rows
    : [];

  return rows.map(mapDbRowToQuestion);
}

/** Create requires topic in query (?topic=...) — unchanged */
export type CreateQuestionPayload = {
  question_text: string;
  options: string[];
  correct_answer: number; // 0-based
  difficulty: 1 | 2 | 3 | 4 | 5;
  topic: string;
  tags?: string[];
  type?: "MCQ" | "Short Answer" | "Essay";
  status?: "draft" | "published" | "archived";
};

export async function createQuestion(body: CreateQuestionPayload) {
  return api.post("/questions", body);
}

/** Generate — strict body per BE Zod (no guessing, no extra props) */
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

export async function getPublishedQuestions(params: ListParams = {}) {
  // Ensure this helper also benefits from normalization
  const normalizedStatus = normalizeStatus(params.status) ?? "published";
  const url = `/questions/published${buildListQuery({
    ...params,
    status: normalizedStatus,
  })}`;
  return api.get<
    DbQuestionRow[] | { items: DbQuestionRow[] } | { rows: DbQuestionRow[] }
  >(url);
}
