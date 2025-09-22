// client/src/services/assignmentService.ts
import { request } from "../lib/api";

/**
 * Existing signature preserved (do not change callers).
 * We adapt its payload to the BE session-creation endpoint.
 */
export async function createAssignmentSvc(payload: {
  candidateIds: string[];
  questionIds: number[]; // ignored here; questions come from DB by filters
  config: any; // expects: topic, count (difficulty optional)
  schedule: any; // unused for now
}) {
  // --- Minimal adapter logic ---
  const firstCandidate = payload?.candidateIds?.[0];
  const candidateId = String(firstCandidate ?? "").trim();

  const cfg = payload?.config ?? {};

  // topic can be a single string or the first entry of topics[]
  const topic: string =
    typeof cfg.topic === "string" && cfg.topic.trim().length > 0
      ? cfg.topic.trim()
      : Array.isArray(cfg.topics)
      ? String(cfg.topics[0] ?? "").trim()
      : "";

  // difficulty is OPTIONAL (kept for compatibility if UI still supplies it)
  const difficulty =
    cfg.difficulty ?? cfg.difficultyLabel ?? cfg.level ?? undefined;

  // count can be named differently in older code paths
  const rawCount =
    cfg.count ?? cfg.questionCount ?? cfg.numQuestions ?? undefined;
  const count =
    rawCount === undefined || rawCount === null
      ? undefined
      : Math.max(1, Math.min(50, Number(rawCount) || 0));

  // ✅ difficulty is NOT required
  if (!candidateId || !topic || count == null) {
    throw new Error(
      "Missing required fields for session creation (candidateId, topic, count)."
    );
  }

  // --- Call the BE endpoint ---
  const body: Record<string, unknown> = { candidateId, topic, count };
  if (
    difficulty !== undefined &&
    difficulty !== null &&
    String(difficulty).trim() !== ""
  ) {
    body.difficulty = difficulty;
  }

  try {
    const res = await request("/assignments/create-session", {
      method: "POST",
      body,
    });

    // Normalize so old callers using `result.id` still work.
    const sessionId = (res as any)?.sessionId ?? (res as any)?.id;
    if (!sessionId) {
      throw new Error("Server did not return a session id");
    }
    return { id: sessionId, sessionId };
  } catch (e: any) {
    // Bubble meaningful server error text to the caller/toast
    const msg =
      (e?.payload && (e.payload.error || e.payload.message)) ||
      e?.message ||
      "Failed to create session";
    throw new Error(String(msg));
  }
}

export async function deleteAssignmentSvc(id: string) {
  return request(`/assignments/${id}`, { method: "DELETE" });
}

export async function updateAssignmentSvc(
  id: string | number,
  patch: { totalQuestions?: number; finishNow?: boolean }
) {
  const body: any = {};
  if (Number.isFinite(patch.totalQuestions as number)) {
    body.totalQuestions = Number(patch.totalQuestions);
  }
  if (patch.finishNow === true) body.finishNow = true;

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
  topic?: string | null; // some APIs may include it directly
};

export async function getMyAssignmentsSvc() {
  return request("/assignments/mine", { method: "GET" });
}
export async function getAssignmentsSvc() {
  return request("/assignments", { method: "GET" });
}
