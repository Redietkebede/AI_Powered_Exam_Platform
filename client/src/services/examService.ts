import { request } from "../lib/api";
import type { Question } from "../types/question";

/* ================== Types ================== */

export type AttemptItem = {
  questionId: string | number;
  topic?: string | null;
  difficulty?: Question["difficulty"] | number;
  type?: Question["type"] | string;
  correct: boolean;
  timeSpentMs: number;
  answeredAt: string; // ISO
};

export type AttemptRecord = {
  // Keep string here because various backends return text ids; the UI treats it as a label.
  attemptId: string;
  candidate: string;
  assignmentId?: string;
  startedAt: string; // ISO
  completedAt?: string | null; // ISO
  items: AttemptItem[];
};

export type AssignmentCompletion = {
  assignmentId: string;
  candidate: string;
  completedAt: string; // ISO
  total: number;
  correct_answer: number;
  score: number; // 0..100
};

/** Result shape used by analytics (back-compat) */
export type Result = {
  candidate: string;
  date: string; // ISO date string
  correct: number;
  total: number;
  score: number; // 0..100
};

/* ================== internal utils ================== */

// Accept several possible keys and coerce to a positive integer id
function coerceNumericId(payload: any): number {
  const raw =
    payload?.attemptId ??
    payload?.sessionId ??
    payload?.id ??
    payload?.data?.attemptId ??
    payload?.data?.sessionId ??
    payload?.data?.id;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    // eslint-disable-next-line no-console
    console.warn("[examService] Could not coerce a numeric id from:", payload);
    throw new Error("Server did not return a valid attempt/session id.");
  }
  return n;
}

function sanitizeTopics(input?: string[] | string): string[] | undefined {
  if (!input) return undefined;
  const arr = Array.isArray(input)
    ? input
    : String(input)
        .split(",")
        .map((t) => t.trim());

  const bad = new Set(["", "-", "—", "general"]);
  const clean = arr.filter((t) => t && !bad.has(t.toLowerCase()));
  return clean.length ? clean : undefined;
}

/* ================== Server-backed helpers (aligned to your routes) ================== */

export async function getAttempts(): Promise<AttemptRecord[]> {
  try {
    const rows = await request<any[]>("/attempts/mine");
    // Normalize a variety of shapes into AttemptRecord
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const attemptId =
        (r as any).attemptId ?? (r as any).sessionId ?? (r as any).id ?? "";
      const candidate =
        (r as any).candidate ?? (r as any).userName ?? (r as any).userId ?? "";
      const startedAt =
        (r as any).startedAt ??
        (r as any).started_at ??
        new Date().toISOString();
      const completedAt =
        (r as any).completedAt ?? (r as any).finished_at ?? null;
      const assignmentId =
        (r as any).assignmentId ?? (r as any).testId ?? undefined;

      return {
        attemptId: String(attemptId),
        candidate: String(candidate),
        assignmentId: assignmentId != null ? String(assignmentId) : undefined,
        startedAt: String(startedAt),
        completedAt: completedAt as string | null,
        items: Array.isArray((r as any).items) ? (r as any).items : [],
      } as AttemptRecord;
    });
  } catch {
    // Best-effort fallback to sessions if present; adapt shape
    try {
      const sessions = await request<any[]>("/sessions/mine");
      return (Array.isArray(sessions) ? sessions : []).map(
        (s): AttemptRecord => ({
          attemptId: String(s.attemptId ?? s.sessionId ?? s.id ?? ""),
          candidate: String(s.candidate ?? s.userId ?? ""),
          assignmentId:
            s.testId != null || s.assignmentId != null
              ? String(s.testId ?? s.assignmentId)
              : undefined,
          startedAt: String(
            s.startedAt ?? s.started_at ?? new Date().toISOString()
          ),
          completedAt: (s.completedAt ?? s.finished_at ?? null) as
            | string
            | null,
          items: [],
        })
      );
    } catch {
      return [];
    }
  }
}

export async function getAssignmentCompletions(): Promise<
  AssignmentCompletion[]
> {
  const list = await request<AssignmentCompletion[]>("/completions/mine");
  return Array.isArray(list) ? list : [];
}

export async function isAssignmentCompleted(
  assignmentId: string,
  _candidate?: string
): Promise<boolean> {
  if (!assignmentId) return false;
  try {
    const one = await request<AssignmentCompletion | null>(
      "/completions/mine",
      {
        method: "GET",
        params: { assignmentId },
      } as any
    );
    return !!one;
  } catch {
    const list = await getAssignmentCompletions();
    return list.some((c) => String(c.assignmentId) === String(assignmentId));
  }
}

export async function getAssignmentCompletion(
  assignmentId: string,
  _candidate?: string
): Promise<AssignmentCompletion | null> {
  if (!assignmentId) return null;
  try {
    return await request<AssignmentCompletion | null>("/completions/mine", {
      method: "GET",
      params: { assignmentId },
    } as any);
  } catch {
    const list = await getAssignmentCompletions();
    return (
      list.find((c) => String(c.assignmentId) === String(assignmentId)) ?? null
    );
  }
}

/**
 * Start attempt — server enforces one-attempt policy and returns a numeric id.
 * NOTE: We default to NOT sending topics unless caller provides non-placeholder topics,
 * to avoid over-filtering to 0 questions.
 */
export async function startAttempt(ctx?: {
  assignmentId?: string | number; // accepted but converted to testId when numeric
  testId?: number; // preferred
  topics?: string[] | string;
  limit?: number;
  durationSeconds?: number;
}): Promise<number> {
  const body: Record<string, unknown> = {};

  // Prefer explicit testId; else coerce assignmentId -> number
  if (typeof ctx?.testId === "number" && Number.isFinite(ctx.testId)) {
    body.testId = ctx!.testId;
  } else if (
    ctx?.assignmentId !== undefined &&
    ctx?.assignmentId !== null &&
    String(ctx.assignmentId).trim() !== "" &&
    Number.isFinite(Number(ctx.assignmentId))
  ) {
    body.testId = Number(ctx.assignmentId);
  }

  // Only attach topics if non-empty and not placeholders
  const topics = sanitizeTopics(ctx?.topics);
  if (topics && topics.length) body.topics = topics;

  // limit: clamp 1..100 (server default 10)
  if (typeof ctx?.limit === "number" && Number.isFinite(ctx.limit)) {
    body.limit = Math.max(1, Math.min(100, Math.floor(ctx.limit)));
  }

  // durationSeconds: optional, positive integer
  if (
    typeof ctx?.durationSeconds === "number" &&
    Number.isFinite(ctx.durationSeconds) &&
    ctx.durationSeconds > 0
  ) {
    body.durationSeconds = Math.floor(ctx.durationSeconds);
  }

  // POST /start (request() adds Authorization header and base /api)
  try {
    const res = await request<any>("/start", { method: "POST", body } as any);
    return coerceNumericId(res);
  } catch (err: any) {
    const msg = String(
      err?.message ||
        err?.payload?.error ||
        err?.payload?.message ||
        "Failed to start exam"
    );

    if (/no published questions|no approved mcq|no questions/i.test(msg)) {
      throw new Error(
        "No published questions available for the requested criteria."
      );
    }
    if (/missing.*test|invalid.*test/i.test(msg)) {
      throw new Error("Missing or invalid test/assignment id.");
    }
    if (/unauth|token|expired|forbidden|authorization/i.test(msg)) {
      throw new Error("Authentication required — please sign in again.");
    }
    throw new Error(msg);
  }
}

/** End/submit attempt — calls your POST /submit route with { attemptId } */
export async function endAttempt(attemptId: number | string): Promise<void> {
  if (attemptId == null || String(attemptId).trim() === "") return;
  const idNum = Number(attemptId);
  await request<{ ok?: boolean; success?: boolean }>("/submit", {
    method: "POST",
    body: { attemptId: Number.isFinite(idNum) ? idNum : String(attemptId) },
  } as any);
}

/** Record per-question data — calls your POST /answer route */
export async function recordAttemptItemRemote(
  attemptId: number | string,
  item: AttemptItem
): Promise<void> {
  try {
    const idNum = Number(attemptId);
    const payload = {
      attemptId: Number.isFinite(idNum) ? idNum : String(attemptId),
      questionId: item.questionId,
      correct: item.correct,
      timeSpentMs: item.timeSpentMs,
      answeredAt: item.answeredAt,
      // optional meta
      topic: item.topic ?? undefined,
      difficulty: item.difficulty ?? undefined,
      type: item.type ?? undefined,
    };
    await request<{ ok?: boolean; success?: boolean }>("/answer", {
      method: "POST",
      body: payload,
    } as any);
  } catch {
    // Endpoint optional; ignore if not implemented
  }
}

/* ================== Analytics back-compat ================== */

export async function getResults(): Promise<Result[]> {
  const comps = await getAssignmentCompletions();
  return comps.map((c) => ({
    candidate: c.candidate,
    date: c.completedAt,
    correct: c.correct_answer,
    total: c.total,
    score: c.score,
  }));
}

/* ================== Minimal adaptive (in-page only) ================== */

let _order: number[] = [];
let _cursor = 0;

function buildOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Deterministic sequential order (unchanged) */
export function getAdaptiveNextQuestion(pool: Question[]): Question | null {
  if (!Array.isArray(pool) || pool.length === 0) return null as any;
  if (_order.length !== pool.length) {
    _order = buildOrder(pool.length);
    _cursor = 0;
  }
  if (_cursor >= _order.length) return null as any;
  const q = pool[_order[_cursor]];
  _cursor += 1;
  return q;
}
