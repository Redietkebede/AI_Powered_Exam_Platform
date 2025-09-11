// client/src/types/api.ts
export type QuestionCreateDTO = {
  question_text: string;
  options: string[];
  correct_answer: number;
  difficulty: number;           // 1..5
  tags?: string[];
};

export type QuestionGenerateDTO = {
  topic: string;
  count: number;
  difficulty?: number;          // 1..5
  tags?: string[];
};
