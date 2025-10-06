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
  difficulty?: number | string; // ignored now
};
type GenerateInput = QuestionGenerateDTO | LegacyGenerateInput;

/* --------------------------- List params (topic OPTIONAL) --------------------------- */
export type ListParams = {
  status?: string; // 'published' | 'approved' | 'pending' | 'rejected' | 'draft' | 'any'
  topic?: string;
  subject?: string; // legacy alias for topic

  // optional – only send if BE supports; we now omit by default in callers
  limit?: number;
  offset?: number;

  search?: string;
  createdBy?: number | string;

  // NOTE: difficulty filter is not used by BE; keep for backward compat but don't send unless needed
  difficulty?: number | string;
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
  if (t === "all") return "any";
  return t;
};

/** Build a query string WITHOUT the leading '?' */
function buildListQuery(params: ListParams = {}): string {
  const sp = new URLSearchParams();

  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    sp.set(k, s);
  };

  // topic OR subject (prefer topic)
  const topic = String(params.topic ?? "")
    .trim()
    .toLowerCase();
  const subject = String(params.subject ?? "")
    .trim()
    .toLowerCase();
  if (topic) sp.set("topic", topic);
  else if (subject) sp.set("topic", subject);

  // status (normalized)
  const st = normalizeStatus(params.status);
  if (st && st !== "any") sp.set("status", st);

  // difficulty (rarely used; keep only if explicitly provided)
  if (params.difficulty !== undefined && params.difficulty !== null) {
    const dnum = toDifficultyNum(params.difficulty);
    if (dnum) sp.set("difficulty", String(Math.min(5, Math.max(1, dnum))));
  }

  // pagination (send only if the route supports them)
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    sp.set("limit", String(Math.floor(params.limit)));
  }
  if (typeof params.offset === "number" && Number.isFinite(params.offset)) {
    sp.set("offset", String(Math.floor(params.offset)));
  }

  add("q", params.search);
  add("createdBy", params.createdBy);

  return sp.toString(); // <-- no leading '?'
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
      // tags omitted intentionally; BE assigns/handles arrays
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
  };
}

/** STRICT to BE schema: (legacy difficulty ignored) */
function toGenerateDTO(input: GenerateInput): QuestionGenerateDTO {
  const topic = String((input as any).topic ?? "").trim();
  if (topic.length < 2) throw new Error("Topic must be at least 2 characters");

  const countRaw =
    (input as any).count ?? (input as any).numberOfQuestions ?? 5;
  const countNum = Math.min(50, Math.max(1, Number(countRaw) || 5));

  const dto: QuestionGenerateDTO = {
    topic,
    // difficulty removed from payload – BE assigns levels
    difficulty: 3, // placeholder for type compatibility, BE ignores it
    count: countNum,
  };
  return dto;
}

/* ------------------------------ Topic helpers ------------------------------ */
export type TopicAvailability = { topic: string; available: number };

export async function getTopics(): Promise<string[]> {
  const rows = await api.get<TopicAvailability[]>("/questions/topics");
  return rows.map((r) => r.topic);
}

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

export async function getPublishedTopics(): Promise<TopicAvailability[]> {
  return await request<TopicAvailability[]>("/questions/topics");
}

/* ------------------------------ Public API ------------------------------ */

/**
 * getQuestions:
 *  - Defaults status to 'published' unless caller sets it.
 *  - Uses buildListQuery() (no leading '?') and concatenates safely.
 *  - Tolerates {rows} | {items} | [] response shapes.
 */
export async function getQuestions(
  params: ListParams = {}
): Promise<Question[]> {
  // Default to published for general use; Approvals passes status=draft explicitly.
  const normalizedStatus = normalizeStatus(params.status) ?? "published";

  // buildListQuery returns "" or something like "?topic=java&status=draft"
  const qs = buildListQuery({ ...params, status: normalizedStatus });

  // Only use /questions/published when status === "published"
  const base =
    normalizedStatus === "published" ? "/questions/published" : "/questions";

  // ✅ FIX: no extra "?" — just concatenate
  const url = qs ? `${base}${qs.startsWith("?") ? "" : "?"}${qs}` : base;

  const data = await api.get<
    { items?: DbQuestionRow[] } | { rows?: DbQuestionRow[] } | DbQuestionRow[]
  >(url);

  const rows: DbQuestionRow[] = Array.isArray(data)
    ? (data as DbQuestionRow[])
    : Array.isArray((data as any)?.items)
    ? (data as any).items
    : Array.isArray((data as any)?.rows)
    ? (data as any).rows
    : [];

  return rows.map(mapDbRowToQuestion);
}

/** Editor "AI Generator" (topic + count only). Hits your existing route. */
export function generateQuestions(input: {
  topic: string;
  count?: number | string; // desired exam length
  numberOfQuestions?: number | string; // legacy alias
  poolMultiplier?: number | string; // NEW: compact pool factor (≈ poolMultiplier * count)
}) {
  const topic = String(input.topic ?? "").trim();
  if (topic.length < 2) throw new Error("Topic must be at least 2 characters");

  const toNum = (v: unknown, def: number, lo: number, hi: number) => {
    const n = typeof v === "number" ? v : Number(v);
    const x = Number.isFinite(n) ? n : def;
    return Math.min(hi, Math.max(lo, Math.floor(x)));
  };

  const count = toNum(input.count ?? input.numberOfQuestions, 5, 1, 50);

  // Default to a small pool ≈ 3× the requested exam length (tweak as you like: 2..6)
  const poolMultiplier = toNum(input.poolMultiplier, 3, 1, 6);

  return api.post("/questions/generate", { topic, count, poolMultiplier });
}

/** If you keep a separate "create" path, keep this thin helper too (optional). */
export async function createQuestions(payload: {
  topic: string;
  count: number;
}) {
  return api.post("/questions/generate", payload); // same route; single source of truth
}

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

export async function updateQuestionStatus(
  id: number,
  status: "pending" | "published" | "rejected" | "draft" | "archived"
): Promise<Question> {
  // keep your existing endpoint; just map the row back
  const row = await api.patch<DbQuestionRow>(`/publish/${id}`, { status });
  return mapDbRowToQuestion(row);
}

export async function removeQuestion(id: number): Promise<void> {
  await api.del<void>(`/questions/${id}?hard=true`);
}

export async function getPublishedQuestions(params: ListParams = {}) {
  const normalizedStatus = normalizeStatus(params.status) ?? "published";
  const qs = buildListQuery({ ...params, status: normalizedStatus });
  const url = qs ? `/questions/published?${qs}` : `/questions/published`;
  return api.get<
    DbQuestionRow[] | { items: DbQuestionRow[] } | { rows: DbQuestionRow[] }
  >(url);
}
export type TopicSufficiency = {
  topic: string;
  examQuestions: number;
  havePerLevel: Record<1 | 2 | 3 | 4 | 5, number>;
  requiredPerLevel: Record<1 | 2 | 3 | 4 | 5, number>;
  sufficient: boolean;
  shortfalls: Array<{ level: 1 | 2 | 3 | 4 | 5; need: number; have: number }>;
};

export async function checkTopicSufficiency(
  topic: string,
  examQuestions: number
) {
  const t = encodeURIComponent(topic.trim());
  const eq = Math.max(1, Math.min(100, Math.floor(examQuestions)));
  return api.get<TopicSufficiency>(
    `/questions/sufficiency?topic=${t}&examQuestions=${eq}`
  );
}
