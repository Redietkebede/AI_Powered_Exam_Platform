import { request } from "../lib/api";

export type SessionTopicDTO = { sessionId: number; topic: string | null };

export async function getSessionTopic(
  sessionId: number
): Promise<SessionTopicDTO> {
  return await request<SessionTopicDTO>(`/sessions/${sessionId}/topic`);
}

export async function getSessionQuestions(sessionId: number): Promise<
  Array<{
    id: number;
    question_text: string;
    options: string[];
    correct_answer: number;
    type: string;
    position: number;
  }>
> {
  return await request(`/sessions/${sessionId}/questions`);
}
