import { z } from "zod";

export const CreateQuestionSchema = z
  .object({
    question_text: z.string().min(1),
    options: z.array(z.string()).min(2),
    correctIndex: z.number().int().min(0),
    difficulty: z.number().int().min(1).max(5),
    tags: z.array(z.string()).optional(),
  })
  .refine((d) => d.correctIndex < d.options.length, {
    path: ["correctIndex"],
    message: "correctIndex must be < options.length",
  });

export const GenerateQuestionsSchema = z.object({
  topic: z.string().min(1),
  count: z.number().int().positive().max(50),
  difficulty: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
});

// ---- Export types for the FE
export type CreateQuestionDTO = z.infer<typeof CreateQuestionSchema>;
export type GenerateQuestionsDTO = z.infer<typeof GenerateQuestionsSchema>;
