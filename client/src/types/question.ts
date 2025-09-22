// client/src/types/question.ts
export type Question = {
  id: number;

  // canonical UI fields
  text: string;                  // wording
  options: string[];             // same as choices
  choices: string[];             // alias used by some components
  correctIndex: number;          // 0-based index of the correct option
  answer: string;                // convenience = options[correctIndex]
  difficulty: "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
  numericDifficulty: number;     // 1..5
  status: "pending"|"draft" | "published" | "archived" | "rejected" | "approved";
  type: "MCQ";
  tags: string[];
  topic?: string;
  createdAt?: string;

  // legacy aliases still referenced in a few places
  question_text?: string;                 // = text
 };
