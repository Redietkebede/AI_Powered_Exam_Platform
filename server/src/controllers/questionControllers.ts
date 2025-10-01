import { z } from "zod";
import { RequestHandler } from "express";
import { generateQuestions } from "../services/examStructure";
import { insertQuestion, getQuestions } from "../middleware/qustions";
import pool from "../config/db";

type Level = 1 | 2 | 3 | 4 | 5;

const Extras = z.object({
  // adaptive knobs (editor UI can hide these; good defaults)
  stageSize: z.coerce.number().int().min(1).max(50).default(10),
  bufferFactor: z.coerce.number().int().min(1).max(10).default(4),
  levelMixPerStage: z
    .object({
      1: z.coerce.number().int().min(0).optional(),
      2: z.coerce.number().int().min(0).optional(),
      3: z.coerce.number().int().min(0).optional(),
      4: z.coerce.number().int().min(0).optional(),
      5: z.coerce.number().int().min(0).optional(),
    })
    .optional(),
});

// Branch A: current shape { topic, difficulty, count } + extras
const BranchA = z
  .object({
    topic: z.string().min(2, "topic is required"),
    difficulty: z.coerce.number().int().min(1).max(5).default(3),
    count: z.coerce.number().int().min(1).max(50).default(5),
  })
  .merge(Extras);

// Branch B (back-compat): { topic, difficulty, numberOfQuestions } + extras
// → normalized to { topic, difficulty, count, ...extras }
const BranchB = z
  .object({
    topic: z.string().min(2),
    difficulty: z.coerce.number().int().min(1).max(5).default(3),
    numberOfQuestions: z.coerce.number().int().min(1).max(50).default(5),
  })
  .merge(Extras)
  .transform((v) => ({
    topic: v.topic,
    difficulty: v.difficulty,
    count: v.numberOfQuestions,
    stageSize: v.stageSize,
    bufferFactor: v.bufferFactor,
    levelMixPerStage: v.levelMixPerStage,
  }));

// Final schema: accepts both, returns the normalized shape
export const ReqSchema = BranchA.or(BranchB);

// In your handler:
// const { topic, difficulty, count, stageSize, bufferFactor, levelMixPerStage } = ReqSchema.parse(req.body);

const DeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  hard: z.coerce.boolean().optional().default(false),
});

async function getQuestionColumns() {
  const wanted = [
    "status",
    "is_published",
    "published_at",
    "published_by",
    "topic",
    "difficulty",
    "type",
  ];
  const q = `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'questions'
      AND column_name  = ANY($1::text[])
  `;
  const res = await pool.query(q, [wanted]);
  const cols = new Map<string, string>();
  for (const r of res.rows) cols.set(r.column_name, r.data_type ?? "");
  return cols;
}

function buildPublishedPredicate(
  cols: Map<string, string>,
  paramIndexStart = 1
) {
  // normalize status from query if provided
  const pubExprs: string[] = [];
  const params: any[] = [];
  let i = paramIndexStart;

  // Default to 'published'; accept UI 'approved'
  const statusVal = "published";

  if (cols.has("status")) {
    params.push(statusVal);
    pubExprs.push(`LOWER(q.status) = $${i++}`);
    pubExprs.push(`LOWER(q.status) = 'approved'`);
  }
  if (cols.has("is_published")) pubExprs.push(`q.is_published = TRUE`);
  if (cols.has("published_at")) pubExprs.push(`q.published_at IS NOT NULL`);
  if (cols.has("published_by")) pubExprs.push(`q.published_by IS NOT NULL`);

  const pred = pubExprs.length ? `(${pubExprs.join(" OR ")})` : "TRUE";
  return { pred, params, nextIndex: i };
}

/** GET /questions/topics -> [{ topic, available }] */
export const listTopicsWithCounts: RequestHandler = async (req, res) => {
  try {
    const cols = await getQuestionColumns();
    const { pred, params } = buildPublishedPredicate(cols, 1);

    const hasTopic = cols.has("topic");
    if (!hasTopic) return res.json([]); // no topic column -> nothing to show

    const sql = `
      SELECT q.topic AS topic, COUNT(*)::int AS available
      FROM questions q
      WHERE ${pred}
        AND TRIM(COALESCE(q.topic, '')) <> ''
      GROUP BY q.topic
      HAVING COUNT(*) > 0
      ORDER BY LOWER(q.topic) ASC
    `;
    const r = await pool.query(sql, params);
    return res.json(r.rows);
  } catch (err: any) {
    console.error("listTopicsWithCounts error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list topics" });
  }
};

/** GET /questions/available?topic=Rust&type=MCQ -> { topic, type, available } */
export const countAvailableForTopic: RequestHandler = async (req, res) => {
  try {
    const topic = String(req.query.topic ?? "").trim();
    const type = String(req.query.type ?? "").trim(); // optional

    const cols = await getQuestionColumns();
    if (!cols.has("topic")) {
      return res.json({ topic, type, available: 0 });
    }

    const whereParts: string[] = [];
    const params: any[] = [];
    let i = 1;

    const pub = buildPublishedPredicate(cols, i);
    whereParts.push(pub.pred);
    params.push(...pub.params);
    i = pub.nextIndex;

    params.push(topic);
    whereParts.push(`LOWER(q.topic) = LOWER($${i++}::text)`);

    if (type && cols.has("type")) {
      params.push(type);
      whereParts.push(`LOWER(q.type::text) = LOWER($${i++}::text)`);
    }

    const sql = `
      SELECT COUNT(*)::int AS available
      FROM questions q
      WHERE ${whereParts.join(" AND ")}
    `;
    const r = await pool.query(sql, params);

    return res.json({
      topic,
      type,
      available: r.rows?.[0]?.available ?? 0,
    });
  } catch (err: any) {
    console.error("countAvailableForTopic error:", err?.message || err);
    return res
      .status(500)
      .json({ error: "Failed to count available questions" });
  }
};

export const ManualCreateSchema = z.object({
  question_text: z.string().min(1),
  options: z.array(z.string().trim()).default([]), // [] for non-MCQ
  correct_answer: z.number().int().nonnegative().default(0), // 0-based
  difficulty: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  topic: z.string().min(1), // <-- maps to your DB's topic column
  tags: z.array(z.string().trim()).optional(),
  type: z.enum(["MCQ", "Short Answer", "Essay"]).optional(), // if you store it
});

export const createQuestionManual: RequestHandler = async (req, res, next) => {
  try {
    // Hard block: manual route should not accept query params (prevents generator misuse)
    if (Object.keys(req.query || {}).length > 0) {
      return res
        .status(400)
        .json({ error: "Query parameters are not allowed on manual create." });
    }

    const body = ManualCreateSchema.parse(req.body);

    // Defensive clamp: ensure correct_answer is in range for MCQ
    const opts = Array.isArray(body.options) ? body.options : [];
    const maxIdx = Math.max(0, opts.length - 1);
    const correct = Math.min(maxIdx, Math.max(0, body.correct_answer));

    // Insert exactly one row (replace with your DB layer)
    // Replace with your DB layer, e.g. using pool.query or a service function
    const { rows } = await pool.query(
      `INSERT INTO questions (topic, question_text, options, correct_answer, difficulty, tags, type, status)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::text[], $7, $8)
       RETURNING id, topic, question_text, options, correct_answer, difficulty, tags, created_at;`,
      [
        body.topic,
        body.question_text,
        JSON.stringify(opts),
        correct,
        body.difficulty,
        body.tags ?? [],
        body.type ?? "MCQ",
        "draft",
      ]
    );
    const created = rows[0];

    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Invalid input", details: err.issues });
    }
    next(err);
  }
};

// same defaults we use elsewhere: 10-per stage, 1/2/4/2/1 mix, ×4 buffer
// at top of the file (or near your other types

/** keep your existing version; unchanged except for clarity */
// Keep your existing imports/types (ReqSchema, Level, pool, insertQuestion, generateQuestions, etc.)

/** Existing (unchanged): large buffered requirement calculator */
function computeLevelRequirements(params: {
  examQuestions: number;
  stageSize?: number;
  bufferFactor?: number;
  levelMixPerStage?: Partial<Record<Level, number>>;
}) {
  const stageSize = params.stageSize ?? 10;
  const buf = params.bufferFactor ?? 4;
  const defMix: Record<Level, number> = { 1: 1, 2: 2, 3: 4, 4: 2, 5: 1 };

  const mix: Record<Level, number> = {
    1: params.levelMixPerStage?.[1] ?? defMix[1],
    2: params.levelMixPerStage?.[2] ?? defMix[2],
    3: params.levelMixPerStage?.[3] ?? defMix[3],
    4: params.levelMixPerStage?.[4] ?? defMix[4],
    5: params.levelMixPerStage?.[5] ?? defMix[5],
  };

  const sum = mix[1] + mix[2] + mix[3] + mix[4] + mix[5] || stageSize;

  const normMix: Record<Level, number> =
    sum === stageSize
      ? mix
      : ((): Record<Level, number> => {
          const scaled = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
            Level,
            number
          >;
          (Object.keys(mix) as unknown as Level[]).forEach((L) => {
            scaled[L] = Math.max(0, Math.round((mix[L] * stageSize) / sum));
          });
          if (Object.values(scaled).every((v) => v === 0))
            scaled[3] = stageSize;
          return scaled;
        })();

  const stages = Math.max(1, Math.ceil(params.examQuestions / stageSize));

  const expectedDrawPerLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
    Level,
    number
  >;
  (Object.keys(normMix) as unknown as Level[]).forEach((L) => {
    expectedDrawPerLevel[L] = (normMix[L] ?? 0) * stages;
  });

  const requiredPerLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
    Level,
    number
  >;
  (Object.keys(expectedDrawPerLevel) as unknown as Level[]).forEach((L) => {
    requiredPerLevel[L] = Math.max(1, Math.ceil(expectedDrawPerLevel[L] * buf));
  });

  return {
    stages,
    stageSize,
    bufferFactor: buf,
    levelMixPerStage: normMix,
    expectedDrawPerLevel,
    requiredPerLevel,
    mode: "buffered" as const,
  };
}

/** NEW: compact pool (~ poolMultiplier × count) with 1:2:4:2:1 mix by default */
function computeCompactPool(params: {
  examQuestions: number;
  poolMultiplier?: number; // default 3×
  levelMix?: Partial<Record<Level, number>>; // optional override
}) {
  const N = Math.max(1, Math.floor(params.examQuestions));
  const k = Math.max(1, Math.floor(params.poolMultiplier ?? 3)); // default 3
  const base: Record<Level, number> = {
    1: params.levelMix?.[1] ?? 1,
    2: params.levelMix?.[2] ?? 2,
    3: params.levelMix?.[3] ?? 4,
    4: params.levelMix?.[4] ?? 2,
    5: params.levelMix?.[5] ?? 1,
  };
  const baseSum = base[1] + base[2] + base[3] + base[4] + base[5];
  const target = N * k;

  // proportional rounding
  const wanted: Record<Level, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let allocated = 0;
  (Object.keys(base) as unknown as Level[]).forEach((L) => {
    const q = Math.round((base[L] / baseSum) * target);
    wanted[L] = q;
    allocated += q;
  });

  // nudge so sum === target
  const order: Level[] = [3, 2, 4, 1, 5];
  let diff = target - allocated;
  let i = 0;
  while (diff !== 0) {
    const L = order[i % order.length];
    wanted[L] = Math.max(1, wanted[L] + (diff > 0 ? 1 : -1));
    diff += diff > 0 ? -1 : 1;
    i++;
  }

  return {
    requiredPerLevel: wanted,
    expectedDrawPerLevel: wanted, // for reporting parity
    stageSize: undefined,
    bufferFactor: undefined,
    levelMixPerStage: undefined,
    mode: "compact" as const,
    poolMultiplier: k,
  };
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** ─────────────────────────────────────────────────────────────────────
 *  POST /api/questions/generate
 *  Body:
 *    - topic, count
 *    - OPTIONAL compact: poolMultiplier        ← small pool (~k×count)
 *    - OPTIONAL buffered: stageSize, bufferFactor, levelMixPerStage
 *  Generates only the **deficit** per level (status = 'draft').
 *  ───────────────────────────────────────────────────────────────────── */


export const createQuestions: RequestHandler = async (req, res) => {
  try {
    // Parse with your existing Zod schema (leave as-is)
    const parsed = ReqSchema.parse(req.body) as any;

    const topic: string = String(parsed.topic ?? "");
    const count: number = Math.max(1, Number(parsed.count ?? 1));
    const stageSizeIn: number | undefined = Number.isFinite(parsed.stageSize)
      ? Number(parsed.stageSize)
      : undefined;
    const bufferFactorIn: number | undefined = Number.isFinite(
      parsed.bufferFactor
    )
      ? Number(parsed.bufferFactor)
      : undefined;
    const levelMixPerStageIn: Partial<Record<Level, number>> | undefined =
      parsed.levelMixPerStage;
    const poolMultiplierIn: number | undefined =
      parsed.poolMultiplier != null &&
      Number.isFinite(Number(parsed.poolMultiplier))
        ? Number(parsed.poolMultiplier)
        : undefined;

    // ────────────────────────────────────────────────────────────────────
    // Helper: build a compact plan when poolMultiplier is present.
    //   - Uses the same 1..5 difficulty weights as your stage mix.
    //   - Produces { expectedDrawPerLevel, requiredPerLevel } like your
    //     buffered planner so the rest of the code remains unchanged.
    // ────────────────────────────────────────────────────────────────────
    const planCompact = (params: {
      examQuestions: number;
      poolMultiplier: number; // e.g. 2 → ~2× exam size total pool
      levelMix?: Partial<Record<Level, number>>;
    }) => {
      const defMix: Record<Level, number> = { 1: 1, 2: 2, 3: 4, 4: 2, 5: 1 };
      const mix: Record<Level, number> = {
        1: params.levelMix?.[1] ?? defMix[1],
        2: params.levelMix?.[2] ?? defMix[2],
        3: params.levelMix?.[3] ?? defMix[3],
        4: params.levelMix?.[4] ?? defMix[4],
        5: params.levelMix?.[5] ?? defMix[5],
      };
      const W = Math.max(1, mix[1] + mix[2] + mix[3] + mix[4] + mix[5]);

      const totalPool = Math.max(
        params.examQuestions,
        Math.ceil(params.examQuestions * params.poolMultiplier)
      );

      const expectedDrawPerLevel: Record<Level, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      };
      const requiredPerLevel: Record<Level, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      };

      (Object.keys(mix) as unknown as Level[]).forEach((L) => {
        expectedDrawPerLevel[L] = Math.max(
          0,
          Math.ceil((params.examQuestions * (mix[L] ?? 0)) / W)
        );
        requiredPerLevel[L] = Math.max(
          1,
          Math.ceil((totalPool * (mix[L] ?? 0)) / W)
        );
      });

      return {
        mode: "compact" as const,
        poolMultiplier: params.poolMultiplier,
        expectedDrawPerLevel,
        requiredPerLevel,
      };
    };

    // ────────────────────────────────────────────────────────────────────
    // Choose planning mode:
    //   * compact (small pool) if poolMultiplier is provided
    //   * buffered (your original) otherwise, but with safe defaults
    //     so we don’t blow up tiny requests into 40+ questions.
    // ────────────────────────────────────────────────────────────────────
    const reqs =
      Number.isFinite(poolMultiplierIn) && (poolMultiplierIn as number) > 0
        ? planCompact({
            examQuestions: count,
            poolMultiplier: Math.max(
              1,
              Math.min(6, Math.floor(poolMultiplierIn as number))
            ), // cap sensibly
            levelMix: levelMixPerStageIn,
          })
        : (() => {
            // Keep your buffered logic, but pick compact defaults if caller didn’t send any.
            const wantedStage =
              typeof stageSizeIn === "number" && stageSizeIn > 0
                ? Math.floor(stageSizeIn)
                : count;

            // never let stage size exceed the number of questions requested
            const effectiveStageSize = Math.max(
              3,
              Math.min(10, Math.min(wantedStage, count))
            );

            const effectiveBuffer =
              typeof bufferFactorIn === "number" && bufferFactorIn > 0
                ? Math.max(1, Math.min(6, Math.floor(bufferFactorIn)))
                : 2; // smaller default buffer than 4

            const r = computeLevelRequirements({
              examQuestions: count,
              stageSize: effectiveStageSize,
              bufferFactor: effectiveBuffer,
              levelMixPerStage: levelMixPerStageIn,
            });

            // annotate (non-breaking extra fields for your response)
            return {
              ...r,
              mode: "buffered" as const,
              stageSize: effectiveStageSize,
              bufferFactor: effectiveBuffer,
              levelMixPerStage: r.levelMixPerStage,
            };
          })();

    // ────────────────────────────────────────────────────────────────────
    // What we already have (draft + published/approved)
    // ────────────────────────────────────────────────────────────────────
    const existing = await pool.query<{
      difficulty: number;
      available: number;
    }>(
      `
      SELECT difficulty::int AS difficulty, COUNT(*)::int AS available
      FROM questions
      WHERE LOWER(TRIM(topic)) = LOWER($1)
        AND LOWER(TRIM(COALESCE(status,''))) IN ('draft','published','approved')
      GROUP BY difficulty
      `,
      [topic]
    );

    const have: Record<Level, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    existing.rows.forEach((r) => {
      const L = Math.max(1, Math.min(5, Number(r.difficulty))) as Level;
      have[L] = Number(r.available ?? 0);
    });

    // ────────────────────────────────────────────────────────────────────
    // Deficit per level = required – have
    // ────────────────────────────────────────────────────────────────────
    const toCreate: Record<Level, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (Object.keys(reqs.requiredPerLevel) as unknown as Level[]).forEach((L) => {
      toCreate[L] = Math.max(
        0,
        (reqs.requiredPerLevel[L] ?? 0) - (have[L] ?? 0)
      );
    });

    // trackers (for response)
    const generatedPerLevel: Record<
      Level,
      { requested: number; generated: number; inserted: number }
    > = {
      1: { requested: toCreate[1], generated: 0, inserted: 0 },
      2: { requested: toCreate[2], generated: 0, inserted: 0 },
      3: { requested: toCreate[3], generated: 0, inserted: 0 },
      4: { requested: toCreate[4], generated: 0, inserted: 0 },
      5: { requested: toCreate[5], generated: 0, inserted: 0 },
    };

    let totalInserted = 0;

    // ────────────────────────────────────────────────────────────────────
    // Generate only the deficit per level, insert as draft
    // ────────────────────────────────────────────────────────────────────
    for (const L of [1, 2, 3, 4, 5] as const) {
      const need = toCreate[L];
      if (need <= 0) continue;

      const payload = await generateQuestions(topic, L, need);
      const items = (payload?.questions ?? []) as Array<{
        question_text?: string;
        question?: string;
        options?: string[] | unknown[];
        correct_answer?: number | string;
        answerIndex?: number;
        answer?: string;
        answerText?: string;
        explanation?: string | string[] | null;
        tags?: string[] | string;
      }>;

      generatedPerLevel[L].generated = items.length;

      for (const q of items) {
        if (generatedPerLevel[L].inserted >= need) break;

        // options → exactly 4 strings
        const opts: string[] = Array.isArray(q?.options)
          ? (q.options as unknown[]).slice(0, 4).map(String)
          : [];
        if (opts.length !== 4) continue;

        // resolve correct index 0..3
        let idx: number =
          typeof q?.correct_answer === "number"
            ? q.correct_answer
            : Number.isFinite(Number(q?.correct_answer))
            ? Number(q?.correct_answer)
            : -1;

        if (idx < 0 || idx >= 4) {
          const ai = Number(q?.answerIndex);
          if (!Number.isNaN(ai) && ai >= 0 && ai < 4) idx = ai;
          else if (!Number.isNaN(ai) && ai >= 1 && ai <= 4) idx = ai - 1;
        }
        if (idx < 0 || idx >= 4) {
          const ansText = norm(q?.correct_answer ?? q?.answer ?? q?.answerText);
          if (ansText) idx = opts.findIndex((o) => norm(o) === ansText);
        }
        if (idx < 0 || idx >= 4) continue;

        // explanation → string[] | null
        const explanationArr: string[] | null = Array.isArray(q?.explanation)
          ? (q.explanation as unknown[]).map((s: any) => String(s))
          : typeof q?.explanation === "string" && q.explanation.trim() !== ""
          ? [q.explanation.trim()]
          : null;

        // tags → string[]
        const tagsArr: string[] = Array.isArray(q?.tags)
          ? (q.tags as unknown[]).map((t: any) => String(t))
          : typeof q?.tags === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(q.tags);
                return Array.isArray(parsed) ? parsed.map(String) : [];
              } catch {
                return [];
              }
            })()
          : [];

        await insertQuestion({
          topic: String(topic),
          difficulty: L,
          question_text: String(q?.question_text ?? q?.question ?? "").trim(),
          options: opts,
          correct_answer: idx,
          explanation: explanationArr,
          tags: tagsArr,
          status: "draft", // send to Approvals
          type: "MCQ",
        });

        generatedPerLevel[L].inserted += 1;
        totalInserted += 1;
      }
    }

    if (totalInserted === 0) {
      return res.status(422).json({
        error: "No valid questions generated",
        details: {
          topic,
          examQuestions: count,
          requiredPerLevel: reqs.requiredPerLevel,
        },
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // Response (keeps fields your FE expects; adds harmless context)
    // ────────────────────────────────────────────────────────────────────
    return res.json({
      inserted: totalInserted,
      topic,
      difficulty: 3, // placeholder; mixed levels inserted
      mode: (reqs as any).mode ?? "buffered",
      poolMultiplier: (reqs as any).poolMultiplier ?? undefined,
      examQuestions: count,
      stageSize: (reqs as any).stageSize ?? undefined,
      bufferFactor: (reqs as any).bufferFactor ?? undefined,
      levelMixPerStage: (reqs as any).levelMixPerStage ?? undefined,
      expectedDrawPerLevel: reqs.expectedDrawPerLevel,
      requiredPerLevel: reqs.requiredPerLevel,
      existingPerLevel: have,
      resultPerLevel: generatedPerLevel, // requested(deficit)/generated/inserted
    });
  } catch (err: any) {
    if (res.headersSent) return;
    const status = Number(err?.status) || 400;
    const details = err?.issues ?? err?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.error("[createQuestions] failed:", details);
    return res.status(status).json({ error: "failed to generate", details });
  }
};

export const listQuestions: RequestHandler = async (req, res) => {
  try {
    // read & sanitize
    const topicRaw = String(req.query.topic ?? "").trim();
    const statusRaw = String(req.query.status ?? "")
      .trim()
      .toLowerCase(); // e.g. 'draft' | 'published' | 'rejected'
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    if (!topicRaw) {
      return res.status(400).json({ error: "Topic is required" });
    }

    // build WHERE: topic (case-insensitive) + optional status
    const where: string[] = [];
    const params: any[] = [];

    params.push(topicRaw);
    where.push(`LOWER(TRIM(q.topic)) = LOWER(TRIM($${params.length}))`);

    if (statusRaw) {
      params.push(statusRaw);
      where.push(`LOWER(TRIM(q.status)) = LOWER(TRIM($${params.length}))`);
    }

    const sql = `
      SELECT
        q.id,
        q.topic,
        q.question_text,
        q.options,
        q.correct_answer,
        q.difficulty,
        q.tags,
        q.explanation,
        q.status,
        q.type,
        q.created_at
      FROM questions q
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `;

    const { rows } = await pool.query(sql, params);
    return res.json({ total: rows.length, items: rows });
  } catch (e: any) {
    console.error("[listQuestions] failed:", e);
    return res
      .status(500)
      .json({ error: e?.message ?? "Failed to fetch questions" });
  }
};

// GET /questions/published?topic=...&difficulty=...&limit=...&offset=...
export const listPublishedQuestions: RequestHandler = async (req, res) => {
  try {
    const topicRaw = String(req.query.topic ?? "").trim();
    const diffRaw = String(req.query.difficulty ?? "").trim();
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 1000));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    // Optional status override from query (normalize UI wording)
    const statusRaw = String(req.query.status ?? "")
      .trim()
      .toLowerCase();
    const normalizedStatus =
      statusRaw === "approved" ? "published" : statusRaw || "published";

    // Columns we may reference for filtering and selecting
    const wanted = Array.from(
      new Set([
        // publish-state columns
        "status",
        "is_published",
        "published_at",
        "published_by",
        // filter columns
        "topic",
        "difficulty",
        // safe select columns (explicitly omit correct_answer)
        "id",
        "question_text",
        "options",
        "type",
        "created_at",
      ])
    );

    const colsRes = await pool.query(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'questions'
          AND column_name  = ANY($1::text[])
      `,
      [wanted]
    );

    // Map: column name -> data_type
    const cols = new Map<string, string>();
    for (const r of colsRes.rows) cols.set(r.column_name, r.data_type ?? "");

    // --------------------- Build WHERE parts & params ---------------------
    const whereParts: string[] = [];
    const params: any[] = [];
    let i = 1;

    // "Published" predicate: OR across whichever columns exist
    const pubExprs: string[] = [];
    if (cols.has("status")) {
      params.push(normalizedStatus);
      pubExprs.push(`LOWER(q.status) = $${i++}`);
      // Also tolerate legacy "approved" rows if they exist
      pubExprs.push(`LOWER(q.status) = 'approved'`);
    }
    if (cols.has("is_published")) {
      pubExprs.push(`q.is_published = TRUE`);
    }
    if (cols.has("published_at")) {
      pubExprs.push(`q.published_at IS NOT NULL`);
    }
    if (cols.has("published_by")) {
      pubExprs.push(`q.published_by IS NOT NULL`);
    }
    // If nothing is known, default TRUE (shouldn't happen with current schema)
    whereParts.push(pubExprs.length ? `(${pubExprs.join(" OR ")})` : "TRUE");

    // Topic filter only if column exists and a topic was provided
    const useTopic = cols.has("topic") && topicRaw !== "";
    if (useTopic) {
      params.push(topicRaw);
      whereParts.push(`LOWER(q.topic) = LOWER($${i++}::text)`);
    }

    // Difficulty filter — handle numeric or text schemas
    const hasDiff = cols.has("difficulty");
    const diffType = cols.get("difficulty") || "";
    const diffIsNumeric = /int|numeric|decimal|real|double/i.test(diffType);

    const labelToNum: Record<string, number> = {
      "very easy": 1,
      easy: 2,
      medium: 3,
      hard: 4,
      "very hard": 5,
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
    };

    if (hasDiff && diffRaw) {
      if (diffIsNumeric) {
        const mapped = labelToNum[diffRaw.toLowerCase()];
        const asNum = Number.isFinite(mapped) ? mapped : Number(diffRaw);
        if (Number.isFinite(asNum)) {
          params.push(asNum);
          whereParts.push(`q.difficulty = $${i++}::int`);
        }
        // else: unknown label -> skip difficulty filter
      } else {
        params.push(diffRaw);
        whereParts.push(
          `LOWER(TRIM(q.difficulty::text)) = LOWER(TRIM($${i++}::text))`
        );
      }
    }

    const whereSQL = whereParts.length
      ? `WHERE ${whereParts.join(" AND ")}`
      : "";

    // --------------------------- SELECT list ------------------------------
    const selectable = [
      "id",
      "question_text",
      "options",
      "difficulty",
      "topic",
      "type",
      "created_at",
    ];
    const selectCols: string[] = [];
    for (const c of selectable) {
      if (cols.has(c)) selectCols.push(`q.${c}`);
    }
    if (!selectCols.length) selectCols.push("q.id"); // minimal

    // ------------------------------ Query --------------------------------
    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT ${selectCols.join(", ")}
      FROM questions q
      ${whereSQL}
      ORDER BY q.id ASC
      LIMIT $${i++} OFFSET $${i++}
    `;

    const r = await pool.query(sql, params);

    // Extra safety: strip correct_answer if a view/trigger added it anyway
    const sanitized = r.rows.map((row: any) => {
      if ("correct_answer" in row) {
        const { correct_answer, ...rest } = row;
        return rest;
      }
      return row;
    });

    return res.json(sanitized);
  } catch (err: any) {
    console.error("listPublishedQuestions error:", err?.message || err);
    return res
      .status(500)
      .json({ error: "Failed to list published questions" });
  }
};

export async function insertMany(
  questions: Parameters<typeof insertQuestion>[0][]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const q of questions) {
      await client.query(
        `
        INSERT INTO questions
          (topic, question_text, options, correct_answer, difficulty, tags, explanation, status)
        VALUES
          ($1,    $2,            $3::jsonb, $4,            $5,         $6::text[], $7::text[], 'draft')
        ON CONFLICT (topic, question_text) DO NOTHING
        `,
        [
          q.topic, // $1
          q.question_text, // $2
          JSON.stringify(q.options), // $3 -> jsonb
          q.correct_answer, // $4
          q.difficulty, // $5
          Array.isArray(q.tags) ? q.tags.map(String) : [], // $6 -> text[]
          q.explanation == null
            ? null
            : Array.isArray(q.explanation)
            ? q.explanation.map(String)
            : [String(q.explanation)], // $7 -> text[] (or null)
          q.status ?? "draft",
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export const deleteQuestion: RequestHandler = async (req, res) => {
  try {
    const { ids, hard } = DeleteSchema.parse(req.body);

    if (hard) {
      const { rows } = await pool.query(
        `DELETE FROM questions WHERE id = ANY($1::int[]) RETURNING id;`,
        [ids]
      );
      return res.json({
        deleted: rows.length,
        ids: rows.map((r) => r.id),
        hard: true,
      });
    }

    const { rows } = await pool.query(
      `UPDATE questions SET deleted_at = NOW()
        WHERE id = ANY($1::int[]) AND deleted_at IS NULL
        RETURNING id;`,
      [ids]
    );
    return res.json({
      deleted: rows.length,
      ids: rows.map((r) => r.id),
      hard: false,
    });
  } catch (err: any) {
    const details = err?.issues ?? err?.message ?? String(err);
    return res.status(400).json({ error: "failed to delete", details });
  }
};

export const deleteQuestionById: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }

  // hard delete if ?hard=1 or ?hard=true
  const hard = /^(1|true)$/i.test(String(req.query.hard ?? "0"));

  try {
    if (hard) {
      // HARD DELETE: physically remove the row
      const { rowCount } = await pool.query(
        "DELETE FROM questions WHERE id = $1",
        [id]
      );
      if (!rowCount) return res.status(404).json({ error: "not found" });
      return res.status(204).send();
    }

    // SOFT DELETE: keep history, hide from lists
    const { rowCount } = await pool.query(
      `UPDATE questions
         SET deleted_at = NOW(),
             status = COALESCE(NULLIF(status,''), 'archived')
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount)
      return res.status(404).json({ error: "not found or already archived" });
    return res.json({ deleted: 1, id, hard: false });
  } catch (e: any) {
    // FK violation (referenced elsewhere) → advise soft delete or cascade
    if (e?.code === "23503") {
      return res.status(409).json({
        error:
          "Cannot hard-delete: other records reference this question. Use soft delete or add ON DELETE CASCADE.",
      });
    }
    return res
      .status(500)
      .json({ error: "failed to delete", details: e.message });
  }
};

// GET /api/questions/sufficiency?topic=java&examQuestions=10
export const getTopicSufficiency: RequestHandler = async (req, res) => {
  try {
    const topic = String(req.query.topic ?? "")
      .trim()
      .toLowerCase();
    const examQuestions = Math.max(
      1,
      Math.min(100, Number(req.query.examQuestions ?? 10))
    );

    if (!topic) return res.status(400).json({ error: "Missing topic" });

    // count *published/approved* per difficulty for the topic
    const { rows } = await pool.query<{
      difficulty: number;
      available: number;
    }>(
      `
      SELECT difficulty::int, COUNT(*)::int AS available
      FROM questions
      WHERE lower(trim(topic)) = $1
        AND (lower(trim(status)) IN ('published','approved'))
      GROUP BY difficulty
      `,
      [topic]
    );

    const byLevel: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    for (const r of rows) {
      const d = Math.max(1, Math.min(5, Number(r.difficulty)));
      byLevel[d as 1 | 2 | 3 | 4 | 5] = Number(r.available || 0);
    }

    // reuse your helper from createQuestions()
    const reqs = computeLevelRequirements({
      examQuestions,
      // keep defaults (stageSize 10, bufferFactor 4, mix 1/2/4/2/1) or
      // pass custom policy via query if you want
    });

    // check sufficiency
    const shortfalls: Array<{
      level: 1 | 2 | 3 | 4 | 5;
      need: number;
      have: number;
    }> = [];
    (
      Object.keys(reqs.requiredPerLevel) as Array<unknown> as (
        | 1
        | 2
        | 3
        | 4
        | 5
      )[]
    ).forEach((L) => {
      const need = reqs.requiredPerLevel[L];
      const have = byLevel[L];
      if (have < need) shortfalls.push({ level: L, need, have });
    });

    res.json({
      topic,
      examQuestions,
      havePerLevel: byLevel,
      requiredPerLevel: reqs.requiredPerLevel,
      sufficient: shortfalls.length === 0,
      shortfalls, // helpful details for the UI
    });
  } catch (e: any) {
    console.error("[getTopicSufficiency] failed:", e);
    res.status(500).json({ error: "Server error" });
  }
};
