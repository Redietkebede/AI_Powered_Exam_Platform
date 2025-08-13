import OpenAI from "openai";

const required = ["OPENROUTER_API_KEY", "LLM_BASE_URL", "LLM_MODEL"] as const;
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing env var ${k}`);
}

export const llm = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: process.env.LLM_BASE_URL!, // lets you swap OpenRouter/local easily
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:2800",
    "X-Title": "AI-Powered Exam Platform",
  },
});

export const LLM_MODEL = process.env.LLM_MODEL!;
