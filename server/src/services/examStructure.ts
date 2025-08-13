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
  question_text: z.string().min(5),
  options: z.array(z.string()).length(4), // exactly 4 choices
  correct_answer: z.number().int().min(0).max(3), // 0..3 maps to A..D
  explanation: z.string().optional().nullable().default(null),
  tags: z.array(z.string()).default([]),
});

export const ExamJSONSchema = z.object({
  topic: z.string().min(2),
  difficulty: z.number().int().min(1).max(5),
  questions: z.array(MCQSchema).min(1).max(50),
});
export type MCQ = z.infer<typeof MCQSchema>;
export type ExamJSON = z.infer<typeof ExamJSONSchema>;

// ---- helpers ----
function coerceJSON(text: string): string {
  let s = (text ?? "").trim();

  // strip code fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // If it's a JS-style concatenated string:  "....\n" + "...."
  if (/^["'`]/.test(s) && /["'`]\s*\+\s*["'`]/.test(s)) {
    // remove the concatenation operators and outer quotes
    s = s
      .replace(/^\s*["'`]/, "")
      .replace(/["'`]\s*\+\s*["'`]/g, "")
      .replace(/["'`]\s*$/, "");

    // it may now be an escaped JSON string → unescape once
    try {
      s = JSON.parse(s);
    } catch {
      /* ignore */
    }
  }

  // finally, extract the first {...} or [...] block
  const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return m ? m[1] : s;
}

// Helper: pick a random temp in the range
function getRandomTemp(min = TEMP_MIN, max = TEMP_MAX) {
  return +(Math.random() * (max - min) + min).toFixed(2);
}

// ---- main API ----

async function callLLM(content: string, temperature: number) {
  try {
    return await llm.chat.completions.create({
      model: LLM_MODEL as string,
      temperature,
      messages: [
        {
          role: "system",
          content:
            "Return ONLY a valid JSON object with keys: topic, difficulty, questions[]. " +
            "Each question must have: question_text, options (exactly 4 strings), correct_answer (1), explanation (optional), tags (array). " +
            "No code fences. No comments. No string concatenation."
        },
        { role: "user", content },
      ],
    });
  } catch (e: any) {
    console.error("[LLM] HTTP error", {
      status: e?.status ?? e?.response?.status,
      data: e?.response?.data ?? e?.message ?? String(e),
    });
    // surface a useful status upstream
    const err = new Error(
      e?.response?.data?.error?.message || e?.message || "LLM request failed"
    ) as any;
    err.status = e?.status || e?.response?.status || 502;
    throw err;
  }
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
    console.error("[LLM] json-parse-error", { cleaned, error: String(error) });
    throw new Error("LLM returned non-JSON content");
  }

  // 3) Validate schema — log if it fails
  const result = ExamJSONSchema.safeParse(parsed);
  if (!result.success) {
    logBadGen("schema-validation-failed", {
      topic,
      difficulty,
      count,
      cleaned,
      zod: result.error.flatten(),
    });
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    console.error("[LLM] schema-validation-failed", {
      topic,
      difficulty,
      count,
      preview: cleaned.slice(0, 1200),
      issues,
    });
    throw new Error("LLM JSON failed schema validation");
  }

  // 4) (optional) normalize to exactly 4 options + clamp index
  const payload = result.data;
  payload.questions = payload.questions.map((q) => {
    const options = q.options.slice(0, 4);
    const correct_answer = Math.max(0, Math.min(3, q.correct_answer));
    return { ...q, options, correct_answer };
  });

  return payload;
}
