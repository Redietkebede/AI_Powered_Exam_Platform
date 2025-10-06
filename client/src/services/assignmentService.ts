// client/src/services/assignmentService.ts
import { request } from "../lib/api";

/* Parse minutes from many UI shapes: 30, "30", "30m", "30 min" */
function toMinutes(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return Math.floor(input);
  if (typeof input === "string") {
    const m = input.match(/^\s*(\d+)\s*(m|min|minutes?)?\s*$/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Existing signature preserved. We adapt config → BE payload and INCLUDE time.
 */
export async function createAssignmentSvc(payload: {
  candidateIds: string[];
  questionIds: number[];   // ignored here; DB picks by filters
  config: any;             // topic, count, and may contain time in various keys
  schedule: any;           // unused for now
}) {
  // candidateId comes as string; coerce to number
  const firstCandidate = payload?.candidateIds?.[0];
  const candidateId = Number(firstCandidate);
  if (!Number.isFinite(candidateId)) {
    throw new Error("Invalid candidateId");
  }

  const cfg = payload?.config ?? {};

  // topic may be a string or the first of topics[]
  const topic: string =
    typeof cfg.topic === "string" && cfg.topic.trim()
      ? cfg.topic.trim()
      : Array.isArray(cfg.topics)
      ? String(cfg.topics[0] ?? "").trim()
      : "";

  const rawCount = cfg.count ?? cfg.questionCount ?? cfg.numQuestions;
  const count =
    rawCount == null ? undefined : Math.max(1, Math.min(100, Number(rawCount) || 0));

  if (!topic || count == null) {
    throw new Error("Missing required fields (topic, count).");
  }

  // —— TIME LIMIT (the important part) ——
  const minutes =
    toMinutes(cfg.allowedTimeMinutes) ??
    toMinutes(cfg.timeLimitMinutes) ??
    toMinutes(cfg.timeLimit) ??
    toMinutes(cfg.durationMinutes) ??
    toMinutes(cfg.duration) ??
    toMinutes(cfg?.review?.timeLimit) ??
    null;

  const body: Record<string, unknown> = { candidateId, topic, count };

  // include minutes if present so BE stores seconds
  if (minutes !== null && minutes >= 0) body.allowedTimeMinutes = minutes;

  // if you have a test id in config, forward it
  if (cfg.testId != null && Number.isFinite(Number(cfg.testId))) {
    body.testId = Number(cfg.testId);
  }

  const res = await request("/assignments/create-session", {
    method: "POST",
    body,
  });

  const sessionId = (res as any)?.sessionId ?? (res as any)?.id;
  if (!sessionId) throw new Error("Server did not return a session id");
  return { id: sessionId, sessionId };
}

export async function deleteAssignmentSvc(id: string) {
  return request(`/assignments/${id}`, { method: "DELETE" });
}

export async function updateAssignmentSvc(
  id: string | number,
  patch: { totalQuestions?: number; finishNow?: boolean; allowedTimeMinutes?: number | string }
) {
  const body: any = {};
  if (Number.isFinite(patch.totalQuestions as number)) {
    body.totalQuestions = Number(patch.totalQuestions);
  }
  if (patch.finishNow === true) body.finishNow = true;

  const mins = toMinutes(patch.allowedTimeMinutes);
  if (mins !== null && mins >= 0) body.allowedTimeMinutes = mins;

  return request(`/assignments/${id}`, { method: "PATCH", body });
}

export async function getAssignmentByIdSvc(id: string | number) {
  return request(`/assignments/${id}`, { method: "GET" });
}

export type DbSessionRow = {
  id: number;
  user_id: number;
  test_id: number | null;
  total_questions: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  user?: { id: number; name?: string | null };
  test?: { id: number; topic?: string | null };
  topic?: string | null;
};

export async function getMyAssignmentsSvc() {
  return request("/assignments/mine", { method: "GET" });
}
export async function getAssignmentsSvc() {
  return request("/assignments", { method: "GET" });
}
