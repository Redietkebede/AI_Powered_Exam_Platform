export type Difficulty = 1 | 2 | 3 | 4 | 5;

export function examPrompt(topic: string, difficulty: Difficulty, count: number = 5) {
  return `
You are an expert exam item writer.

Generate ${count} multiple-choice questions about "${topic}" at difficulty ${difficulty}.

### Rules:
- Each question MUST have exactly 4 options (A–D).
- Randomize the order of the options so that the correct answer is **not always the first option**.
- The "correct_answer" MUST be the zero-based index (0, 1, 2, or 3) of the correct option in the "options" array.
- Double-check that the option at "correct_answer" is truly the correct one.
- Provide a clear and concise "explanation" string for why the chosen option is correct.
- Add 1–3 topical "tags".
- Return ONLY valid JSON. No markdown, no comments, no extra text.

### JSON to produce:
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

