// client/src/services/analytics.ts
import { request } from "../lib/api";
import {
  getResults,
  getAttempts,
  type AttemptRecord as ExamAttempt,
  type Result,
} from "./examService";
import { getQuestions } from "./questionService";

/** --- PUBLIC: Summary KPIs for a given topic --- */
export async function getAnalyticsSummary(topic: string) {
  const qs = new URLSearchParams();
  const t = (topic ?? "").trim();
  if (t) qs.set("topic", t);
  if (!t) {
    // Safe empty summary if no topic provided
    return {
      kpis: { candidates: 0, exams: 0, avgScore: 0, questions: 0 },
      timeline: [] as Array<{ label: string; score: number }>,
      byDifficulty: [
        { label: "Easy", score: 0 },
        { label: "Medium", score: 0 },
        { label: "Hard", score: 0 },
      ],
    };
  }

  // Server-backed calls are async now
  const results = await getResults();
  const questions = await getQuestions({ topic: t, limit: 1000, offset: 0 });

  const candidates = new Set(results.map((r) => r.candidate)).size;
  const exams = results.length;
  const avgScore = exams
    ? Math.round(results.reduce((a, b) => a + (b.score || 0), 0) / exams)
    : 0;

  // Synthetic timeline for the summary widget
  const timeline = Array.from({ length: 7 }).map((_, i) => ({
    label: `Day ${i + 1}`,
    score: Math.max(40, Math.min(95, avgScore + (i - 3) * 3)),
  }));

  const byDifficulty = [
    { label: "Easy", score: 80 },
    { label: "Medium", score: 70 },
    { label: "Hard", score: 60 },
  ];

  return {
    kpis: { candidates, exams, avgScore, questions: questions.length ?? 0 },
    timeline,
    byDifficulty,
  };
}

export type AnalyticsFilters = {
  candidate?: string;
  topic?: string;
  difficulty?: "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
  candidateId?: number;
};

/** --- PUBLIC: Full analytics for a given topic --- */
export async function getAnalyticsDetails(
  topic: string,
  filters: AnalyticsFilters = {}
) {
  const t = String(topic ?? "").trim();

  // Async server calls
  const allResults = await getResults();
  const allAttempts = await getAttempts();

  const results = filterResults(allResults, filters);
  const { items } = filterAttempts(allAttempts, filters);

  // 🔹 topic is for questions-backed KPIs (count by topic)
  const questions = t
    ? await getQuestions({ topic: t, limit: 1000, offset: 0 })
    : [];

  const candidates = new Set(results.map((r) => r.candidate)).size;
  const exams = results.length;
  const avgScore = exams
    ? Math.round(results.reduce((a, b) => a + (b.score || 0), 0) / exams)
    : 0;

  const timeline = computeTimeline(results);
  const byDifficulty = computeByDifficulty(items);
  const byDifficultyCounts = computeDifficultyCounts(items);
  const topicStats = computetopicStats(items);

  const topPerformers = [...results]
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, 5)
    .map((r) => ({
      candidate: r.candidate,
      score: r.score,
      attempts: r.total,
      lastActive: r.date,
    }));

  const recentActivity = [...results]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6)
    .map((r) => ({
      candidate: r.candidate,
      date: r.date,
      score: r.score,
      correct: r.correct,
      total: r.total,
    }));

  const timeHistogram = computeTimeHistogram(items);
  const candidateProgression = computeCandidateProgression(
    results,
    filters.candidate
  );

  return {
    kpis: { candidates, exams, avgScore, questions: questions.length ?? 0 },
    timeline,
    byDifficulty,
    byDifficultyCounts,
    topPerformers,
    recentActivity,
    topicStats,
    timeHistogram,
    candidateProgression,
  };
}

/** --- OPTIONAL: topics for a given topic (unique topic list) --- */
export async function gettopics(topic: string): Promise<string[]> {
  const t = String(topic ?? "").trim();
  if (!t) return [];
  const q = await getQuestions({ topic: t, limit: 1000, offset: 0 });
  return Array.from(new Set((q as any[]).map((x: any) => x.topic)))
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .sort();
}

/* ---------------- internal helpers (updated for async services) ---------------- */

function filterResults(results: Result[], f: AnalyticsFilters) {
  return results.filter((r) => {
    if (f.candidate && r.candidate !== f.candidate) return false;
    return true;
  });
}

function filterAttempts(attempts: ExamAttempt[], f: AnalyticsFilters) {
  const filteredAttempts = attempts.filter((a) => {
    if (f.candidate && a.candidate !== f.candidate) return false;
    return true;
  });
  const items = filteredAttempts
    .flatMap((a) => a.items)
    .filter((i) => {
      if (f.topic && i.topic !== f.topic) return false;
      if (f.difficulty && i.difficulty !== f.difficulty) return false;
      return true;
    });
  return { items };
}

// date filtering intentionally omitted per requirements

function computeTimeline(results: Result[]) {
  // average score per day over last N results, keeping label readable
  const byDay: Record<string, { sum: number; count: number }> = {};
  for (const r of results) {
    const day = new Date(r.date).toISOString().slice(0, 10);
    const bucket = byDay[day] ?? { sum: 0, count: 0 };
    bucket.sum += r.score;
    bucket.count += 1;
    byDay[day] = bucket;
  }
  const days = Object.keys(byDay).sort();
  return days.map((day) => ({
    label: day,
    score: Math.round(byDay[day].sum / byDay[day].count),
  }));
}

function computeByDifficulty(
  items: ReturnType<typeof filterAttempts>["items"]
) {
  const order: Array<"Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard"> = [
    "Very Easy",
    "Easy",
    "Medium",
    "Hard",
    "Very Hard",
  ];
  return order.map((label) => {
    const s = items.filter((i) => i.difficulty === label);
    const accuracy = s.length
      ? Math.round((s.filter((i) => i.correct).length / s.length) * 100)
      : 0;
    return { label, score: accuracy };
  });
}

function computeDifficultyCounts(
  items: ReturnType<typeof filterAttempts>["items"]
) {
  const order: Array<"Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard"> = [
    "Very Easy",
    "Easy",
    "Medium",
    "Hard",
    "Very Hard",
  ];
  return order.map((label) => ({
    label,
    count: items.filter((i) => i.difficulty === label).length,
  }));
}

function computetopicStats(items: ReturnType<typeof filterAttempts>["items"]) {
  const bytopic: Record<
    string,
    { correct: number; total: number; timeMs: number; count: number }
  > = {};
  for (const item of items) {
    const key = String(item.topic ?? "—");
    const bucket = bytopic[key] ?? {
      correct: 0,
      total: 0,
      timeMs: 0,
      count: 0,
    };
    bucket.correct += item.correct ? 1 : 0;
    bucket.total += 1;
    bucket.timeMs += item.timeSpentMs;
    bucket.count += 1;
    bytopic[key] = bucket;
  }
  const rows = Object.entries(bytopic).map(([topic, s]) => ({
    topic,
    accuracy: s.total ? Math.round((s.correct / s.total) * 100) : 0,
    avgTimeSec: s.count ? Math.round(s.timeMs / s.count / 1000) : 0,
  }));
  rows.sort((a, b) => a.accuracy - b.accuracy);
  return rows;
}

function computeTimeHistogram(
  items: ReturnType<typeof filterAttempts>["items"]
) {
  const buckets = [10, 20, 30, 45, 60]; // seconds thresholds; last is 60+
  const counts = new Array(buckets.length + 1).fill(0);
  for (const i of items) {
    const s = i.timeSpentMs / 1000;
    let idx = buckets.findIndex((b) => s <= b);
    if (idx === -1) idx = buckets.length;
    counts[idx] += 1;
  }
  const labels = ["0-10s", "10-20s", "20-30s", "30-45s", "45-60s", "60s+"];
  return { labels, counts };
}

function computeCandidateProgression(results: Result[], candidate?: string) {
  if (!candidate) return { labels: [] as string[], scores: [] as number[] };
  const rows = results
    .filter((r) => r.candidate === candidate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return {
    labels: rows.map((r) => new Date(r.date).toLocaleDateString()),
    scores: rows.map((r) => r.score),
  };
}

/** Candidates list (server-backed) */
export async function getCandidates(): Promise<string[]> {
  const [results, attempts] = await Promise.all([getResults(), getAttempts()]);
  const fromResults = new Set(results.map((r) => r.candidate));
  const fromAttempts = new Set(attempts.map((a) => a.candidate));
  const all = new Set<string>([...fromResults, ...fromAttempts]);
  return Array.from(all).filter(Boolean).sort();
}

export type AnalyticsOverview = {
  candidates: number;
  examsTaken: number;
  avgScore: number;
  questions: number;
  performanceOverTime: Array<{ label: string; score: number }>;
  scoresByDifficulty: Array<{ difficulty: string; accuracy_pct: number }>;
  topicInsights: Array<{ topic: string; accuracy_pct: number }>;
  /** histogram buckets: ≤30s, 31–60s, 61–90s, 91–120s, 120s+ */
  timeSpentSeconds: number[];
};

export async function getAnalyticsOverview(
  filters: AnalyticsFilters = {}
): Promise<AnalyticsOverview> {
  const params = new URLSearchParams();
  if (filters.candidateId != null)
    params.set("candidateId", String(filters.candidateId));
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);

  const qs = params.toString();
  const path = qs ? `/analytics/overview?${qs}` : "/analytics/overview";
  return await request<AnalyticsOverview>(path);
}
