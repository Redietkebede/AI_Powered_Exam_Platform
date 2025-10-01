export type Level = 1 | 2 | 3 | 4 | 5;

export type Routing = "PROMOTE" | "HOLD" | "DEMOTE";

export type CTConfig = {
  stageSize: number; // e.g., 10
  difficultyFactors: Record<Level, number>; // e.g., {1:0.8,...,5:1.2}
  timeWeights: Record<Level, number>; // e.g., {1:1.2,...,5:0.8}
  routing: {
    promote: { minStageScore: number; minAccuracy: number };
    hold: {
      stageScoreRange: [number, number]; // [lo, hi)
      or?: { minAccuracy?: number; minAvgR?: number };
    };
    demote: { maxStageScore: number; or?: { maxAccuracy?: number } };
    guards: { maxWrongFastForPromotion: number };
  };
};

// ---------- Time model (BATM) ----------
/** Expected time for the next item, in ms. */
export function batmExpectedMs(
  timeRemainingSec: number,
  remainingQuestions: number,
  level: Level,
  timeWeights: CTConfig["timeWeights"]
): number {
  const basePerQMs =
    (Math.max(0, timeRemainingSec) * 1000) / Math.max(1, remainingQuestions);
  return Math.round(basePerQMs * (timeWeights[level] ?? 1));
}

/** Pace ratio r = actual / expected (unitless). */
export function paceRatio(actualMs: number, expectedMs: number): number {
  const exp = Math.max(1, expectedMs);
  return Math.max(0, actualMs) / exp;
}

// ---------- Per-item scoring ----------
/**
 * Returns a clamped score in [-0.20, 1.50] combining:
 *  - correctness (1 or 0)
 *  - time bonus (fast: +0.20, on-time: +0.10, slow: +0.00)
 *  - guess penalty (wrong & fast: −0.20)
 * then scaled by a per-level difficulty factor (L1=0.8 … L5=1.2 default).
 */
export function scoreItem(
  level: Level,
  correct: boolean,
  r: number,
  difficultyFactors: CTConfig["difficultyFactors"]
): number {
  const diffF = difficultyFactors[level] ?? 1;
  const timeBonus = r <= 0.8 ? 0.2 : r <= 1.2 ? 0.1 : 0.0;
  const guessPenalty = !correct && r <= 0.8 ? -0.2 : 0.0;
  const base = (correct ? 1 : 0) + timeBonus;
  const raw = diffF * base + guessPenalty;
  return clamp(raw, -0.2, 1.5);
}

// ---------- Stage aggregation & routing ----------
export type StageItem = { correct: boolean; r: number; score: number };

export type StageAggregate = {
  items: number;
  correct: number;
  accuracy: number; // correct/items
  stageScore: number; // sum of scores
  avgR: number; // mean pace ratio
  wrongFast: number; // wrong answers with r <= 0.8
};

export function aggregateStage(items: StageItem[]): StageAggregate {
  const n = Math.max(1, items.length);
  const correct = items.reduce((c, it) => c + (it.correct ? 1 : 0), 0);
  const stageScore = items.reduce((s, it) => s + it.score, 0);
  const avgR = items.reduce((s, it) => s + it.r, 0) / n;
  const wrongFast = items.reduce(
    (c, it) => c + (!it.correct && it.r <= 0.8 ? 1 : 0),
    0
  );
  return {
    items: n,
    correct,
    accuracy: correct / n,
    stageScore,
    avgR,
    wrongFast,
  };
}

export function routeStage(agg: StageAggregate, cfg: CTConfig): Routing {
  const { routing } = cfg;
  const { stageScore, accuracy, avgR, wrongFast } = agg;

  // Guard: too many fast wrongs → never promote this stage
  const canPromote = wrongFast <= routing.guards.maxWrongFastForPromotion;

  if (
    canPromote &&
    stageScore >= routing.promote.minStageScore &&
    accuracy >= routing.promote.minAccuracy
  ) {
    return "PROMOTE";
  }

  const [holdLo, holdHi] = routing.hold.stageScoreRange;
  const holdByRange = stageScore >= holdLo && stageScore < holdHi;
  const holdByAlt =
    (routing.hold.or?.minAccuracy
      ? accuracy >= routing.hold.or.minAccuracy
      : false) &&
    (routing.hold.or?.minAvgR ? avgR > routing.hold.or.minAvgR : false);

  if (holdByRange || holdByAlt) return "HOLD";

  const demoteByScore = stageScore < routing.demote.maxStageScore;
  const demoteByAcc =
    routing.demote.or?.maxAccuracy !== undefined &&
    accuracy < routing.demote.or.maxAccuracy;

  return demoteByScore || demoteByAcc ? "DEMOTE" : "HOLD";
}

function clampLevel(n: number): Level {
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  return n as 2 | 3 | 4; // safe after the guards
}

export function nextLevel(current: Level, route: Routing): Level {
  const next =
    route === "PROMOTE"
      ? current + 1
      : route === "DEMOTE"
      ? current - 1
      : current;
  return clampLevel(next);
}

// ---------- Helpers ----------
export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Convenience helper to build a StageItem from a single response.
 * Use this immediately on submit so you can persist per-item telemetry.
 */
export function buildStageItem(
  level: Level,
  correct: boolean,
  actualMs: number,
  expectedMs: number,
  cfg: Pick<CTConfig, "difficultyFactors">
): StageItem {
  const r = paceRatio(actualMs, expectedMs);
  const score = scoreItem(level, correct, r, cfg.difficultyFactors);
  return { correct, r, score };
}
