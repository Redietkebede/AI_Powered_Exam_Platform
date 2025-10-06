import { useMemo, useState, useEffect } from "react";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

import { getCurrentUser, type User } from "../../services/userService";
import {
  getMyAttempts,
  getAttemptSummary,
  getAttemptItems,
  type AttemptItem,
  type MyAttempt,
  type AttemptSummary,
} from "../../services/attemptService";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

// Small CSS used by the <select> (kept minimal; no visual change)
const customStyles = `
.custom-select { background-color: white; }
`;

function normalizeTopic(s?: string | null): string {
  const v = (s ?? "").trim();
  return v || "Uncategorized";
}

// pick whichever field your API returns first
const pickDifficulty = (it: any): number | null =>
  (it?.question_difficulty ??
    it?.questionDifficulty ??
    it?.difficulty ??
    it?.numeric_difficulty ??
    it?.numericDifficulty ??
    null) as number | null;

// clamp to 1..5, default to Medium (3) instead of "Very Hard"
const toDifficultyLabel = (
  n?: unknown
): "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard" => {
  const v = Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  return v <= 1
    ? "Very Easy"
    : v === 2
    ? "Easy"
    : v === 3
    ? "Medium"
    : v === 4
    ? "Hard"
    : "Very Hard";
};

export default function ResultsPage() {
  // (kept) not used in UI but left to preserve original structure
  const [user, setUser] = useState<User | null>(null);
  const [candidateName, setCandidateName] = useState<string>("");

  // attempts list for dropdown + KPI bases
  const [attempts, setAttempts] = useState<MyAttempt[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(
    null
  );

  // server summary for the selected attempt
  const [summary, setSummary] = useState<AttemptSummary | null>(null);
  const [summariesById, setSummariesById] = useState<
    Record<number, AttemptSummary>
  >({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getMyAttempts();
        if (!alive) return;
        setAttempts(list ?? []);
        console.debug("[ResultsPage] attempts:", list);

        // auto-select: first valid attempt id (usually latest after sorting below)
        if ((list?.length ?? 0) > 0 && selectedAttemptId == null) {
          const firstValid = (list as any[]).find((a) =>
            Number.isFinite(Number((a as any).id ?? (a as any).attemptId))
          );
          const firstId = Number(
            (firstValid as any)?.id ?? (firstValid as any)?.attemptId
          );
          if (Number.isFinite(firstId)) setSelectedAttemptId(firstId);
        }
      } catch {
        if (!alive) return;
        setAttempts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Store candidate name only (avoid type mismatch)
  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u as any); // keep original state around
        setCandidateName(String((u as any)?.name ?? ""));
      })
      .catch(() => setCandidateName(""));
  }, []);

  useEffect(() => {
    if (selectedAttemptId == null || Number.isNaN(Number(selectedAttemptId))) {
      setSummary(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const s = await getAttemptSummary(Number(selectedAttemptId));
        if (!alive) return;
        setSummary(s);
        console.debug("[ResultsPage] summary:", s);
      } catch {
        if (!alive) return;
        setSummary(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedAttemptId]);

  // Get attempts for the current candidate only
  const candidateAttempts = useMemo<MyAttempt[]>(
    () => attempts ?? [],
    [attempts]
  );

  // Sort attempts by finished_at (fallback created_at) — latest first
  const sortedAttempts = useMemo(() => {
    const list = (candidateAttempts ?? []).slice();
    list.sort((a: any, b: any) => {
      const ta = new Date(a?.finished_at ?? a?.created_at ?? 0).getTime();
      const tb = new Date(b?.finished_at ?? b?.created_at ?? 0).getTime();
      return tb - ta;
    });
    return list;
  }, [candidateAttempts]);

  useEffect(() => {
    if (selectedAttemptId != null) return;

    const firstValid = (sortedAttempts as any[]).find((a) =>
      Number.isFinite(Number(a?.id ?? a?.attemptId))
    );
    if (!firstValid) return;

    const id = Number(firstValid.id ?? firstValid.attemptId);
    if (Number.isFinite(id)) {
      setSelectedAttemptId(id);
      console.debug("[ResultsPage] auto-select ->", id);
    }
  }, [sortedAttempts, selectedAttemptId]);

  useEffect(() => {
    if (!candidateAttempts.length) return;
    let alive = true;

    (async () => {
      const validIds = candidateAttempts
        .map((a) => Number((a as any).id ?? (a as any).attemptId))
        .filter((n) => Number.isFinite(n));

      const missing = validIds.filter((id) => summariesById[id] == null);

      if (!missing.length) return;

      const entries = await Promise.all(
        missing.map(async (id) => [id, await getAttemptSummary(id)] as const)
      );

      if (alive) {
        setSummariesById((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      }
    })();

    return () => {
      alive = false;
    };
  }, [candidateAttempts, summariesById]);

  // Pick the selected attempt from dropdown (string id)
  const selectedAttempt = useMemo<MyAttempt | null>(() => {
    const id = selectedAttemptId;
    return (
      candidateAttempts.find(
        (a: any) => String(a.attemptId ?? a.id) === String(id)
      ) ??
      candidateAttempts[0] ??
      null
    );
  }, [candidateAttempts, selectedAttemptId]);

  // Map the DB report to an AttemptRecord shape so downstream UI stays unchanged
  const [attemptItems, setAttemptItems] = useState<AttemptItem[]>([]);
  useEffect(() => {
    if (selectedAttemptId == null || Number.isNaN(Number(selectedAttemptId))) {
      setAttemptItems([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const rows = await getAttemptItems(Number(selectedAttemptId), {
          limit: 1000,
        });

        if (alive) setAttemptItems(rows ?? []);
        console.debug("[ResultsPage] attemptItems:", rows);
      } catch {
        if (alive) setAttemptItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedAttemptId]);

  // =========================
  // Aggregations / KPIs
  // =========================

  // Overall candidate performance summary
  const candidateStats = useMemo(() => {
    const summaries = candidateAttempts
      .map((a: any) => summariesById[Number(a?.id ?? a?.attemptId)])
      .filter(Boolean) as AttemptSummary[];

    const totalAttempts = summaries.length;
    if (!totalAttempts) {
      return {
        totalAttempts: 0,
        avgScore: 0,
        totalQuestions: 0,
        correctAnswers: 0,
        overallAccuracy: 0,
      };
    }

    const totalQuestions = summaries.reduce(
      (s, x) => s + (x.total_questions ?? 0),
      0
    );

    const correctAnswers = summaries.reduce(
      (s, x) => s + (x.correct_questions ?? 0),
      0
    );

    const avgScore = Math.round(
      summaries.reduce((s, x) => {
        const tq = x.total_questions ?? 0;
        const cq = x.correct_questions ?? 0;
        return s + (tq > 0 ? (100 * cq) / tq : 0);
      }, 0) / totalAttempts
    );

    const overallAccuracy =
      totalQuestions > 0
        ? Math.round((100 * correctAnswers) / totalQuestions)
        : 0;

    return {
      totalAttempts,
      avgScore,
      totalQuestions,
      correctAnswers,
      overallAccuracy,
    };
  }, [candidateAttempts, summariesById]);

  // Topics present in this attempt (source of truth)
  const attemptTopics = useMemo<string[]>(
    () =>
      Array.from(
        new Set(
          attemptItems.map((it) => normalizeTopic((it as any).topic as string))
        )
      ).sort(),
    [attemptItems]
  );

  // Selected attempt: topic accuracy (locked to allowed topics / asked topics)
  const topicStats = useMemo(() => {
    if (!selectedAttempt)
      return [] as { topic: string; correct: number; total: number }[];

    // Build tallies from the items we actually asked
    const tallies: Record<string, { correct: number; total: number }> = {};
    for (const it of attemptItems) {
      const k = normalizeTopic((it as any).topic as string);
      if (!tallies[k]) tallies[k] = { correct: 0, total: 0 };
      tallies[k].total += 1;
      tallies[k].correct += it.correct ? 1 : 0;
    }

    // If the attempt has an explicit allowed topics list, keep only those
    const rawAllowed: string[] = Array.isArray((selectedAttempt as any)?.topics)
      ? ((selectedAttempt as any).topics as string[])
      : [];

    const allowed =
      rawAllowed.length > 0 ? rawAllowed.map(normalizeTopic) : attemptTopics; // fallback: only topics that actually appeared

    return allowed
      .map((t) => ({
        topic: t,
        correct: tallies[t]?.correct ?? 0,
        total: tallies[t]?.total ?? 0,
      }))
      .filter((r) => r.total > 0); // show only topics that appeared
  }, [selectedAttempt, attemptItems, attemptTopics]);

  // Accuracy by Difficulty (computed from actual items)
  const difficultyStats = useMemo(() => {
    const order = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"] as const;

    // Case-insensitive / numeric → label normalizer
    const toLabel = (v: any): (typeof order)[number] => {
      const s = String(v?.difficulty ?? v ?? "")
        .trim()
        .toLowerCase();
      const n = Number(s);
      if (Number.isFinite(n)) return order[Math.max(0, Math.min(4, n - 1))];
      if (s === "very easy" || s === "very_easy") return "Very Easy";
      if (s === "easy") return "Easy";
      if (s === "medium") return "Medium";
      if (s === "hard") return "Hard";
      if (s === "very hard" || s === "very_hard") return "Very Hard";
      return "Medium";
    };

    // Compute from the actual attempt questions (source of truth)
    const buckets: Record<(typeof order)[number], { c: number; t: number }> = {
      "Very Easy": { c: 0, t: 0 },
      Easy: { c: 0, t: 0 },
      Medium: { c: 0, t: 0 },
      Hard: { c: 0, t: 0 },
      "Very Hard": { c: 0, t: 0 },
    };
    for (const it of attemptItems) {
      const lbl = toLabel({ difficulty: pickDifficulty(it) });
      buckets[lbl].t += 1;
      if (it.correct) buckets[lbl].c += 1;
    }
    return order.map((label) => ({
      label,
      accuracy:
        buckets[label].t > 0
          ? Math.round((100 * buckets[label].c) / buckets[label].t)
          : 0,
    }));
  }, [attemptItems]);

  // Running accuracy time series
  const timeSeries = useMemo(() => {
    const seq = summary?.sequence ?? []; // booleans in the order answered
    // Prefer the max we know to avoid off-by-one from the BE
    const total = Math.max(
      Number(summary?.total_questions ?? 0),
      attemptItems.length
    );

    if (!total) return { labels: [] as string[], scores: [] as number[] };

    const labels = Array.from({ length: total }, (_, i) => `Q${i + 1}`);

    // Walk the booleans we have; pad the rest by carrying the last accuracy
    const scores: number[] = [];
    let correct = 0;

    for (let i = 0; i < total; i++) {
      if (i < seq.length && seq[i]) correct += 1;
      const denom = Math.max(1, i + 1);
      scores.push(Math.round((100 * correct) / denom));
    }

    return { labels, scores };
  }, [summary, attemptItems.length]);

  const difficultyLine = {
    labels: timeSeries.labels,
    datasets: [
      {
        label: "Running Accuracy",
        data: timeSeries.scores,
        borderColor: "#ff7a59",
        backgroundColor: "rgba(255, 122, 89, 0.1)",
        borderWidth: 3,
        tension: 0.4,
        pointBackgroundColor: "#ff7a59",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
      },
    ],
  };

  const difficultyBars = {
    labels: difficultyStats.map((d) => d.label),
    datasets: [
      {
        label: "Accuracy",
        data: difficultyStats.map((d) => d.accuracy),
        backgroundColor: [
          "#ff7a59",
          "#ff9f7f",
          "#ffb8a3",
          "#ffd1c7",
          "#ffeaea",
        ],
        borderRadius: 8,
        borderSkipped: false,
        borderWidth: 0,
      },
    ],
  };

  console.debug(
    "[ResultsPage] candidateAttempts.len:",
    candidateAttempts.length
  );

  // Empty state: no attempts to show
  if (!candidateAttempts.length) {
    return (
      <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center">
            <div className="w-14 h-14 bg-gradient-to-br from-[#ff7a59]/20 to-[#ff7a59]/30 rounded-2xl flex items-center justify-center mr-5">
              <svg
                className="w-7 h-7 text-[#ff7a59]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#0f2744] mb-1">
                My Exam Results
              </h1>
              <p className="text-gray-600">
                Track your performance and see your progress
              </p>
            </div>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-20 h-20 bg-[#ff7a59]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-[#ff7a59]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-[#0f2744] mb-2">
            No exam attempts yet
          </h3>
          <p className="text-gray-600 mb-4">
            Complete your first exam to see your detailed results and analytics
            here.
          </p>
          <div className="w-24 h-1 bg-[#ff7a59]/20 rounded-full mx-auto"></div>
        </div>
      </div>
    );
  }

  // Everything below is unchanged UI; it now reads from the corrected aggregates
  return (
    <>
      <style>{customStyles}</style>
      <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center">
            <div className="w-14 h-14 bg-gradient-to-br from-[#ff7a59]/20 to-[#ff7a59]/30 rounded-2xl flex items-center justify-center mr-5">
              <svg
                className="w-7 h-7 text-[#ff7a59]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2h0"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#0f2744] mb-1">
                My Exam Results
              </h1>
              <p className="text-gray-600">
                Track your performance and see your progress
              </p>
            </div>
          </div>
        </div>

        {/* Overall Performance Summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-xl font-bold text-[#0f2744] mb-6 flex items-center">
            <div className="w-9 h-9 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
              <svg
                className="w-5 h-5 text-[#ff7a59]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z"
                />
              </svg>
            </div>
            Performance Overview
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-center p-5 bg-gradient-to-br from-[#ff7a59]/5 to-[#ff7a59]/10 rounded-xl border border-[#ff7a59]/20 hover:shadow-md transition-all duration-200">
              <div className="text-3xl font-bold text-[#ff7a59] mb-2">
                {candidateStats.totalAttempts}
              </div>
              <div className="text-sm font-medium text-[#0f2744]">
                Total Attempts
              </div>
            </div>
            <div className="text-center p-5 bg-gradient-to-br from-green-500/5 to-green-500/10 rounded-xl border border-green-200 hover:shadow-md transition-all duration-200">
              <div className="text-3xl font-bold text-green-600 mb-2">
                {candidateStats.avgScore}%
              </div>
              <div className="text-sm font-medium text-[#0f2744]">
                Average Score
              </div>
            </div>
            <div className="text-center p-5 bg-gradient-to-br from-blue-500/5 to-blue-500/10 rounded-xl border border-blue-200 hover:shadow-md transition-all duration-200">
              <div className="text-3xl font-bold text-blue-600 mb-2">
                {candidateStats.correctAnswers}/{candidateStats.totalQuestions}
              </div>
              <div className="text-sm font-medium text-[#0f2744]">
                Correct/Total
              </div>
            </div>
            <div className="text-center p-5 bg-gradient-to-br from-purple-500/5 to-purple-500/10 rounded-xl border border-purple-200 hover:shadow-md transition-all duration-200">
              <div className="text-3xl font-bold text-purple-600 mb-2">
                {candidateStats.overallAccuracy}%
              </div>
              <div className="text-sm font-medium text-[#0f2744]">
                Overall Accuracy
              </div>
            </div>
          </div>
        </div>

        {/* Attempt Selector */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-xl font-bold text-[#0f2744] mb-5 flex items-center">
            <div className="w-9 h-9 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
              <svg
                className="w-5 h-5 text-[#ff7a59]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            Select Exam Attempt
          </h2>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Choose an attempt to view detailed results:
            </label>
            <select
              value={selectedAttemptId ?? ""}
              onChange={(e) =>
                setSelectedAttemptId(
                  e.target.value ? Number(e.target.value) : null
                )
              }
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744] transition-colors custom-select"
              style={{ color: "#374151" }}
            >
              <option value="">Choose an attempt…</option>
              {sortedAttempts.map((a: any, index: number) => {
                const id = Number(a?.id ?? a?.attemptId);
                if (!Number.isFinite(id)) return null; // skip bad rows safely

                const when = new Date(
                  a?.finished_at ?? a?.created_at ?? Date.now()
                ).toLocaleDateString();

                const s = summariesById[id];
                const qCount =
                  Number(s?.total_questions ?? 0) ||
                  Number(a?.total_questions ?? 0) ||
                  0;

                return (
                  <option key={`attempt-${id}`} value={id}>
                    {`Attempt #${index + 1} — ${when} (${qCount} questions)`}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Attempt-specific insights */}
        {selectedAttempt && (
          <>
            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-bold text-[#0f2744] mb-4 flex items-center">
                  <div className="w-8 h-8 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
                    <svg
                      className="w-4 h-4 text-[#ff7a59]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                      />
                    </svg>
                  </div>
                  Running Accuracy
                </h3>
                <div className="mt-4">
                  <Line
                    data={difficultyLine}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: {
                          beginAtZero: true,
                          max: 100,
                          grid: { color: "rgba(0,0,0,0.05)" },
                          ticks: { color: "#6b7280" },
                        },
                        x: {
                          grid: { color: "rgba(0,0,0,0.05)" },
                          ticks: { color: "#6b7280" },
                        },
                      },
                      elements: { point: { hoverBackgroundColor: "#ff7a59" } },
                    }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-bold text-[#0f2744] mb-4 flex items-center">
                  <div className="w-8 h-8 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
                    <svg
                      className="w-4 h-4 text-[#ff7a59]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2"
                      />
                    </svg>
                  </div>
                  Accuracy by Difficulty
                </h3>
                <div className="mt-4">
                  <Bar
                    data={difficultyBars}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: {
                          beginAtZero: true,
                          max: 100,
                          grid: { color: "rgba(0,0,0,0.05)" },
                          ticks: { color: "#6b7280" },
                        },
                        x: {
                          grid: { display: false },
                          ticks: { color: "#6b7280" },
                        },
                      },
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Strengths & Weaknesses */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-[#0f2744] mb-5 flex items-center">
                <div className="w-8 h-8 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
                  <svg
                    className="w-4 h-4 text-[#ff7a59]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                Performance by topic
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        topic
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Correct
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Total
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Accuracy
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicStats.map((row, index) => (
                      <tr
                        key={row.topic}
                        className={`border-b border-gray-100 ${
                          index % 2 === 0 ? "bg-gray-50/50" : "bg-white"
                        }`}
                      >
                        <td className="p-4 font-medium text-[#0f2744]">
                          {row.topic}
                        </td>
                        <td className="p-4 text-gray-700">{row.correct}</td>
                        <td className="p-4 text-gray-700">{row.total}</td>
                        <td className="p-4">
                          <span
                            className={`font-bold text-lg ${
                              row.total > 0
                                ? row.correct / row.total >= 0.7
                                  ? "text-green-600"
                                  : row.correct / row.total >= 0.5
                                  ? "text-[#ff7a59]"
                                  : "text-red-500"
                                : "text-gray-400"
                            }`}
                          >
                            {row.total > 0
                              ? Math.round((row.correct / row.total) * 100)
                              : 0}
                            %
                          </span>
                        </td>
                      </tr>
                    ))}
                    {topicStats.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-8 text-center text-gray-500"
                        >
                          No data available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Question-level breakdown */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-[#0f2744] mb-5 flex items-center">
                <div className="w-8 h-8 bg-[#ff7a59]/10 rounded-xl flex items-center justify-center mr-3">
                  <svg
                    className="w-4 h-4 text-[#ff7a59]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                Question Breakdown
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        #
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        topic
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Difficulty
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Type
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Result
                      </th>
                      <th className="text-left p-4 font-semibold text-[#0f2744] text-sm">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {attemptItems.map((it: AttemptItem, idx: number) => (
                      <tr
                        key={`${it.questionId}-${idx}`}
                        className={`border-b border-gray-100 ${
                          idx % 2 === 0 ? "bg-gray-50/50" : "bg-white"
                        }`}
                      >
                        <td className="p-4 font-medium text-[#ff7a59]">
                          Q{idx + 1}
                        </td>
                        <td className="p-4 text-gray-700">
                          {normalizeTopic(it.topic as string)}
                        </td>
                        <td className="p-4">
                          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {toDifficultyLabel((it as any).difficulty)}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#ff7a59]/10 text-[#ff7a59]">
                            {(it as any).type ?? "MCQ"}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                              it.correct
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {it.correct ? "Correct" : "Incorrect"}
                          </span>
                        </td>
                        <td className="p-4 text-gray-700">
                          {Math.round((it.timeSpentMs ?? 0) / 1000)}s
                        </td>
                      </tr>
                    ))}
                    {(!selectedAttemptId || attemptItems.length === 0) && (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-8 text-center text-gray-500"
                        >
                          No questions available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
