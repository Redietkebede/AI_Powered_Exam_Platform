import OpenAI from "openai";
import { z } from "zod";
import { examPrompt, Difficulty } from "../prompts/prompt";
import { logBadGen } from "../doc/logBadGen";
import { validateQuestion } from "./validateQuestion";
import type { Question } from "../middleware/qustions";

/** --- Robust JSON parsing for flaky model outputs --- */
function sanitizeJsonLike(text: string): string {
  let out = String(text ?? "");

  // strip code fences and "json:" labels
  out = out.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");
  out = out.replace(/^\s*json\s*:/i, "");

  // normalize quotes
  out = out.replace(/[“”]/g, '"').replace(/[‘’‛‹›′`]/g, "'");

  // join accidental "...." + "...."
  if (/^".*"\s*\+\s*".*"$/.test(out)) {
    out = out
      .replace(/\s*\+\s*/g, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  // remove trailing commas before } or ]
  out = out.replace(/,\s*([}\]])/g, "$1");

  // key=value  ->  "key": value   (only after { or ,)
  out = out.replace(
    /([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=(\s*)/g,
    '$1"$2": '
  );

  // ensure keys are quoted: { key: ... } -> { "key": ... }
  out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*):/g, '$1"$2"$3:');

  return out.trim();
}

function tryParseJson(text: string): any | null {
  const cleaned = sanitizeJsonLike(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // last resort: parse first {...} or [...] fragment
    const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

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
  correct_answer: z.number().int().min(0).max(3), // 0..3 index
  explanation: z.string().optional().nullable().default(null),
  tags: z.array(z.string()).default([]),
  difficulty: z.number().int().min(1).max(5).default(3), // 1-5 scale
});
export type MCQ = z.infer<typeof MCQSchema>;

export const ExamJSONSchema = z.object({
  topic: z.string().min(2),
  difficulty: z.number().int().min(1).max(5),
  questions: z.array(MCQSchema).min(1).max(50),
});
export type ExamJSON = z.infer<typeof ExamJSONSchema>;

// ---- helpers ----
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) return `${minutes} min ${seconds} sec`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} sec`;
}

function coerceJSON(text: string): string {
  let s = (text ?? "").trim();

  // strip code fences
  s = s.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");

  // strip concatenated strings like "...." + "...."
  if (/^".*"\s*\+\s*".*"$/.test(s)) {
    s = s
      .replace(/\+\s*"/g, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  // try parse
  try {
    JSON.parse(s);
    return s;
  } catch {
    // try extracting first {...} or [...]
    const match = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return match[0];
    return s;
  }
}

function getRandomTemp(min = TEMP_MIN, max = TEMP_MAX) {
  return +(Math.random() * (max - min) + min).toFixed(2);
}

// ---- call LLM ----
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
            "Each question must have: question_text, options (exactly 4 strings), " +
            "correct_answer (an integer 0–3 indicating the correct option), explanation (optional), tags (array). " +
            "No code fences. No comments. No string concatenation.",
        },
        { role: "user", content },
      ],
    });
  } catch (e: any) {
    console.error("[LLM HTTP error]", e?.response?.status, e?.response?.data);
    const err = new Error(
      e?.response?.data?.error?.message ?? e.message ?? "LLM request failed"
    ) as any;
    err.status = e?.status ?? e?.response?.status ?? 502;
    throw err;
  }
}

// ---- main generateQuestions ----
export async function generateQuestions(
  topic: string,
  difficulty: Difficulty,
  count = 5
) {
  const start = Date.now();
  const userContent = examPrompt(topic, difficulty, count);

  // 1) LLM call
  const resp = await callLLM(userContent, getRandomTemp());
  const raw = resp?.choices?.[0]?.message?.content ?? "";

  // quick, non-destructive cleanup (keeps your original step)
  const cleanedViaHelper = coerceJSON(raw);

  // 2) Parse JSON (tolerant)
  let parsed: any = tryParseJson(cleanedViaHelper);
  if (!parsed) {
    console.error("[LLM json-parse-error]", {
      cleaned: sanitizeJsonLike(cleanedViaHelper).slice(0, 800),
      error: "parse failed",
    });
    // return empty so caller can continue other levels without exploding
    const durationMs = Date.now() - start;
    return {
      topic,
      difficulty,
      questions: [] as Question[],
      generation_time: formatDuration(durationMs),
    };
  }

  // 3) Validate schema (tolerant: log and return empty on failure)
  const result = ExamJSONSchema.safeParse(parsed);
  if (!result.success) {
    logBadGen("schema-validation-failed", {
      topic,
      difficulty,
      raw,
      cleaned: cleanedViaHelper,
      nod: result.error.flatten(),
    });
    const durationMs = Date.now() - start;
    return {
      topic,
      difficulty,
      questions: [] as Question[],
      generation_time: formatDuration(durationMs),
    };
  }

  // 4) Normalize + validate each question
  const payload = result.data as any;
  const srcArray = Array.isArray(payload?.questions) ? payload.questions : [];

  payload.questions = srcArray
    .map((q: any): Question | null => {
      // presence checks
      if (
        !q?.question_text ||
        !Array.isArray(q?.options) ||
        q.options.length < 2
      ) {
        console.warn("⚠️ Skipping invalid question:", q);
        return null;
      }

      // normalize options to strings
      const opts = (q.options as any[])
        .map((o) => String(o ?? ""))
        .filter(Boolean);
      if (opts.length < 2) return null;

      // derive correct index: accept 0-based, 1-based, or text answer
      let idx: number =
        typeof q.correct_answer === "number"
          ? q.correct_answer
          : (() => {
              const asText = String(q.correct_answer ?? "")
                .trim()
                .toLowerCase();
              if (!asText) return -1;
              return opts.findIndex(
                (opt) => opt.trim().toLowerCase() === asText
              );
            })();

      // 1..n -> 0..(n-1)
      if (Number.isFinite(idx) && idx >= 1 && idx <= opts.length) idx = idx - 1;

      // clamp / reject
      if (!Number.isFinite(idx) || idx < 0 || idx >= opts.length) {
        console.warn("⚠️ Skipping question with invalid correct_answer:", q);
        return null;
      }

      const normalizedQ: Question = {
        id: q.id ?? crypto.randomUUID(),
        topic: q.topic ?? "General",
        difficulty: Number(q.difficulty) || 1,
        question_text: String(q.question_text),
        options: opts,
        correct_answer: idx,
        explanation: q.explanation ?? null,
        tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
        created_at: q.created_at ?? new Date().toISOString(),
      };

      return validateQuestion(normalizedQ) ? normalizedQ : null;
    })
    .filter((qq: Question | null): qq is Question => qq !== null);

  const durationMs = Date.now() - start;

  return {
    ...payload,
    generation_time: formatDuration(durationMs),
  };
}
