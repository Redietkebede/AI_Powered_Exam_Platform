// at top (optional toggle)
const DEBUG_API = true;

// ---- Types (adjust if you already have them) ----
export type MyAttempt = {
  id: number;
  test_id: number;
  topic_pick: string;
  total_questions: number;
  finished_at: string;
};

export type AttemptSummary = {
  total_questions: number;
  correct_questions: number;
  average_score: number;
  accuracy_pct: number;
  byDifficulty: { difficulty: string; accuracy_pct: number }[];
  sequence?: boolean[];
};

export type AttemptItem = {
  questionId: number;
  correct: boolean;
  topic?: string | null;
  difficulty?: string | null;
  timeSpentMs?: number | null;
};

// ---- Services (note the <T> generics on request) ----
import { request } from "../lib/api";

export async function getMyAttempts(): Promise<MyAttempt[]> {
  const data = await request<MyAttempt[]>("/attempts/mine");
  if (DEBUG_API)
    console.debug(
      "[attemptService] getMyAttempts ←",
      Array.isArray(data) ? `rows=${data.length}` : data,
      data
    );
  return data; // <-- always return
}

export async function getAttemptSummary(
  attemptId: number
): Promise<AttemptSummary> {
  const data = await request<AttemptSummary>(`/attempts/${attemptId}/summary`);
  if (DEBUG_API)
    console.debug("[attemptService] getAttemptSummary ←", { attemptId, data });
  return data; // <-- always return
}

// only if you use a per-question endpoint
export async function getAttemptItems(
  attemptId: number,
  opts?: { limit?: number; offset?: number }
): Promise<AttemptItem[]> {
  const qs = new URLSearchParams();
  if (opts?.limit != null) qs.set("limit", String(opts.limit));
  if (opts?.offset != null) qs.set("offset", String(opts.offset));

  const url =
    qs.toString().length > 0
      ? `/attempts/${attemptId}/items?${qs.toString()}`
      : `/attempts/${attemptId}/items`;

  const data = await request<AttemptItem[]>(url);

  if (DEBUG_API) {
    console.debug("[attemptService] getAttemptItems →", {
      attemptId,
      limit: opts?.limit,
      offset: opts?.offset,
      rows: Array.isArray(data) ? data.length : "?",
    });
  }
  return data;
}
