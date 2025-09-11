// server/src/utils/zodError.ts
import type { ZodError, ZodIssue } from "zod";

export function formatZodError(err: ZodError) {
  // Flatten union branch errors so you can see which branch failed on what
  const unionBranches =
    (err as any).unionErrors?.flatMap((e: ZodError) => e.issues) ?? [];

  function simplify(i: ZodIssue) {
    return {
      code: i.code,
      path: i.path.join("."),
      message: i.message,
      expected: (i as any).expected,
      received: (i as any).received,
    };
  }

  const top = err.issues.map(simplify);
  const union = unionBranches.map((i: ZodIssue) => ({ ...simplify(i), _union: true }));

  return { top, union };
}
