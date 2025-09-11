// client/src/adapters/questionAdapters.ts
import { request } from "../lib/api";
import type { Question } from "../types/question";
import type { DbQuestionRow } from "./dbQuestionRow";
import { mapDbRowToQuestion } from "./dbQuestionRow";

// ---------- helpers ----------
function labelToNum(label: Question["difficulty"]): number {
  return label === "Very Easy" ? 1
    : label === "Easy"        ? 2
    : label === "Medium"      ? 3
    : label === "Hard"        ? 4
    : 5;
}
function inRange(i: number, len: number) {
  return Number.isInteger(i) && i >= 0 && i < len;
}

// Map client partial -> BE payload (snake_case)
function toDbPayload(partial: Omit<Question, "id"> | Question & { id?: number }): Partial<DbQuestionRow> {
  const options = Array.isArray(partial.options ?? partial.choices)
    ? (partial.options ?? partial.choices)
    : [];

  let correct = typeof partial.correctIndex === "number"
    ? partial.correctIndex
    : options.findIndex((c) => c === partial.answer);

  if (!inRange(correct, options.length)) correct = 0;

  return {
    ...(partial as any).id ? { id: (partial as any).id } : undefined,
    question_text: String(partial.text ?? partial.stem ?? "").trim(),
    options,
    correct_answer: correct,
    difficulty: typeof (partial as any).numericDifficulty === "number"
      ? (partial as any).numericDifficulty
      : labelToNum(partial.difficulty),
    tags: Array.isArray(partial.tags) ? partial.tags : [],
    topic: partial.topic ?? partial.subject ?? null,
    status:
      partial.status === "approved" ? "published"
      : partial.status === "rejected" ? "archived"
      : "draft",
  };
}

// ---------- in-memory cache ----------
let CACHE: Question[] = [];
let INITIALIZED = false;

export async function preloadQuestions(): Promise<void> {
  try {
    const rows = await request<DbQuestionRow[]>("/questions");
    CACHE = (rows ?? []).map(mapDbRowToQuestion);
  } finally {
    INITIALIZED = true;
  }
}

export function getCachedQuestions(): Question[] {
  return CACHE;
}
export function setCachedQuestions(next: Question[]): void {
  CACHE = next;
}
export function isInitialized() { return INITIALIZED; }

// ---------- write helpers (create/delete/patch) ----------

export async function createPartial(partial: Omit<Question, "id">): Promise<void> {
  const body = toDbPayload(partial);

  // optimistic insert
  const optimistic: Question = {
    id: Date.now(),
    ...partial,
  } as Question;
  CACHE = [optimistic, ...CACHE];

  try {
    const real = await request<DbQuestionRow>("/questions", { method: "POST", body });
    // swap optimistic with real
    CACHE = CACHE.map((q) => (q.id === optimistic.id ? mapDbRowToQuestion(real) : q));
  } catch (e) {
    // rollback
    CACHE = CACHE.filter((q) => q.id !== optimistic.id);
    throw e;
  }
}

export async function deleteById(id: number): Promise<void> {
  const prev = CACHE;
  CACHE = CACHE.filter((q) => q.id !== id);
  try {
    await request(`/questions/${id}`, { method: "DELETE" });
  } catch (e) {
    CACHE = prev;
    throw e;
  }
}

export async function updateStatus(id: number, next: Question["status"], meta?: { comment?: string; reviewer?: string }): Promise<void> {
  const prev = CACHE;
  CACHE = CACHE.map((q) => (q.id === id ? { ...q, status: next } : q));

  const dbStatus =
    next === "approved" ? "published"
    : next === "rejected" ? "archived"
    : "draft";

  try {
    await request(`/questions/${id}`, {
      method: "PATCH",
      body: { status: dbStatus, comment: meta?.comment, reviewer: meta?.reviewer },
    });
  } catch (e) {
    CACHE = prev;
    throw e;
  }
}
