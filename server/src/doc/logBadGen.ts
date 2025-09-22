import fs from "node:fs";
import path from "node:path";

export function logBadGen(
  kind: "json-parse-error" | "schema-validation-failed",
  payload: unknown
): void {
  try {
    const dir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const file = path.join(dir, `llm-bad-gen.log`);
    const line = `[${new Date().toISOString()}] ${kind} ${JSON.stringify(
      payload
    )}\n`;
    fs.appendFileSync(file, line, { encoding: "utf8" });
  } catch {
    // fallback to console if filesyquestion_text unavailable
    console.warn("logBadGen fallback:", kind, payload);
  }
}
