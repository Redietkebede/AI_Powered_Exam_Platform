import OpenAI from "openai";
import { z } from "zod";
import { examPrompt, Difficulty } from "../prompts/prompt";
import { logBadGen } from "../doc/logBadGen";

// ---- env & client ----
const { OPENROUTER_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
if (!OPENROUTER_API_KEY || !LLM_BASE_URL || !LLM_MODEL) {
  throw new Error(
    "Missing env vars: OPENROUTER_API_KEY, LLM_BASE_URL, or LLM_MODEL"
  );
}
const TEMP_MIN = Number(process.env.LLM_TEMP_MIN ?? 0.3);
const TEMP_MAX = Number(process.env.LLM_TEMP_MAX ?? 0.7);
if (Number.isNaN(TEMP_MIN) || Number.isNaN(TEMP_MAX) || TEMP_MIN > TEMP_MAX) {
  throw new Error(
    "Invalid temperature range: set LLM_TEMP_MIN <= LLM_TEMP_MAX"
  );
}

const llm = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: LLM_BASE_URL,
});

// ---- types & schema ----
export const MCQSchema = z.object({
  stem: z.string().min(1),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  tags: z.array(z.string()).min(0).max(5).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

const SingleSchema = z.object({
  topic: z.string(),
  difficulty: z.coerce.number().int().min(1).max(5),
  questions: z.array(MCQSchema).min(1),
});

const MultiSchema = z.object({
  topic: z.string(),
  difficulties: z.array(z.coerce.number().int().min(1).max(5)).length(1),
  total: z.number().int().positive().optional(),
  questions: z.array(MCQSchema).min(1),
}).transform(o => ({
  topic: o.topic,
  difficulty: o.difficulties[0],   // normalize to single value
  questions: o.questions,
}));


export const ExamJSONSchema = z.union([SingleSchema, MultiSchema]);
export type MCQ = z.infer<typeof MCQSchema>;
export type ExamJSON = z.infer<typeof ExamJSONSchema>;

// ---- helpers ----
function coerceJSON(text: string): string {
  // Strip accidental fences or prose if the model slips
  // Keep only first {...} or [...] block found.
  const m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return m ? m[1] : text;
}

// Helper: pick a random temp in the range
function getRandomTemp(min = TEMP_MIN, max = TEMP_MAX) {
  return +(Math.random() * (max - min) + min).toFixed(2);
}

// ---- main API ----

async function callLLM(content: string, temperature: number) {
  return llm.chat.completions.create({
    model: LLM_MODEL as string,
    temperature,
    messages: [
      {
        role: "system",
        content:
          "Return ONLY strict JSON. No code fences, no markdown, no commentary. If unsure, output an empty valid JSON object.",
      },
      { role: "user", content },
    ],
  });
}

export async function generateQuestions(
  topic: string,
  difficulty: Difficulty,
  count = 5
) {
 const userContent = examPrompt(topic, difficulty, count);

  // 1) LLM call
  const resp = await callLLM(userContent, getRandomTemp());
  const raw = resp.choices[0]?.message?.content ?? "";
  const cleaned = coerceJSON(raw);

  // 2) Parse JSON — log if it fails
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    logBadGen("json-parse-error", { topic, difficulty, count, cleaned, error: String(error) });
    throw new Error("LLM returned non‑JSON content");
  }

  // 3) Validate schema — log if it fails
  const result = ExamJSONSchema.safeParse(parsed);
  if (!result.success) {
    logBadGen("schema-validation-failed", {
      topic, difficulty, count,
      cleaned,
      zod: result.error.flatten()
    });
    throw new Error("LLM JSON failed schema validation");
  }

  // 4) (optional) normalize to exactly 4 choices + clamp index
  const payload = result.data;
  payload.questions = payload.questions.map(q => {
    const choices = q.choices.slice(0, 4);
    const answerIndex = Math.max(0, Math.min(3, q.answerIndex));
    return { ...q, choices, answerIndex };
  });

  return payload;
}
