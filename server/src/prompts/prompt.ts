export type Difficulty = 1|2|3|4|5;

export function examPrompt(topic: string, difficulty: Difficulty, count = 5) {
  return `
You are an expert exam item writer.

Generate ${count} multiple‑choice questions about "${topic}" at difficulty ${difficulty}.

Rules:
- EXACTLY 4 choices (A–D), one correct answer.
- Provide "answerIndex" (0..3) and a concise "explanation".
- Add 1–3 topical "tags".
- Return ONLY ONE JSON object. No markdown, no backticks, no extra keys.

JSON to produce:
{
  "topic": "${topic}",
  "difficulty": ${difficulty},
  "questions": [
    {
      "stem": "string",
      "choices": ["string","string","string","string"],
      "answerIndex": 0,
      "explanation": "string",
      "tags": ["string","string"]
    }
  ]
}
`;
}
