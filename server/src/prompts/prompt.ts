export type Difficulty = 1|2|3|4|5;

export function examPrompt(topic: string, difficulty: Difficulty, count = 5) {
  return `
You are an expert exam item writer.

Generate ${count} multiple‑choice questions about "${topic}" at difficulty ${difficulty}.

Rules:
- EXACTLY 4 options (A–D), one correct answer.
- Provide "correct_answer" (0..3) and a concise "explanation".
- Add 1–3 topical "tags".
- Return ONLY ONE JSON object. No markdown, no backticks, no extra keys.

JSON to produce:
{
  "topic": "${topic}",
  "difficulty": ${difficulty},
  "questions": [
    {
      "question_text": "string",
      "options": ["string","string","string","string"],
      "correct_answer": 0,
      "explanation": "string",
      "tags": ["string","string"]
    }
  ]
}
`;
}
