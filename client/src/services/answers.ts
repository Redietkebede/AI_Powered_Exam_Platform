import { request } from "../lib/api";

/* ───────── Types ───────── */

export type AnswerDTO = {
  sessionId: number;
  questionId: number;
  selectedIndex: number; // 0..3 (or -1 if blank)
  timeTakenSeconds: number; // >= 1
};

export type AnswerResp = {
  id: number;
  isCorrect: boolean;
};

export type BulkAnswerDTO = {
  sessionId: number;
  answers: Array<{
    questionId: number;
    selectedIndex: number;
    timeTakenSeconds?: number;
  }>;
};

export type SubmitSummary = {
  sessionId: number;
  correctAnswers: number;
  totalQuestions: number;
  score: number; // 0..100
  finishedAt: string; // ISO
  correct?: number; // if BE also returns this
};

/* ───────── Services ───────── */

// Single-answer endpoint (use only if you also post per question)
export async function submitAnswer(dto: AnswerDTO): Promise<AnswerResp> {
  return request<AnswerResp>("/answer", { method: "POST", body: dto });
}

// ✅ Bulk submit on finish — matches BE contract for /submit
export async function submitExam(dto: BulkAnswerDTO): Promise<SubmitSummary> {
  return request<SubmitSummary>("/submit", { method: "POST", body: dto });
}

// (optional) keep a dedicated bulk path only if your BE has it
export async function submitAnswersBulk(
  dto: BulkAnswerDTO
): Promise<{ ok: true }> {
  return request<{ ok: true }>("/answers/bulk", { method: "POST", body: dto });
}

// add to answers service
export async function getSessionAnswers(
  sessionId: number
): Promise<
  Array<{ questionId: number; selectedIndex: number; timeTakenSeconds: number }>
> {
  const res = await fetch(`/api/answers/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to load answers");
  return await res.json();
}
