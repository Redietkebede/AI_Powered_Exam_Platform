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

import {
  getAttempts,
  type AttemptRecord as ExamAttempt,
} from "../../services/examService";
import { getCurrentUser, type User } from "../../services/userService";
import { getQuestions } from "../../services/questionService";
import type { Question } from "../../types/question";

// ✅ add: pull truth from DB for a specific session
import { getSessionQuestions } from "../../services/sessions";
import { getSessionAnswers } from "../../services/answers";

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

function normalizetopic(s?: string | null): string {
  const v = (s ?? "").trim();
  return v || "Uncategorized";
}

// helpers for mapping difficulty (mirror ExamPage)
const toDifficultyLabel = (
  n?: unknown
): "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard" => {
  const v = Number(n);
  if (v <= 1) return "Very Easy";
  if (v === 2) return "Easy";
  if (v === 3) return "Medium";
  if (v === 4) return "Hard";
  return "Very Hard";
};

export default function ResultsPage() {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null
  );

  // (kept) not used in UI but left to preserve original structure
  const [user, setUser] = useState<User | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);

  // DB-backed truth for a specific finished session (attempt)
  const [report, setReport] = useState<{
    sessionId: number;
    total: number;
    correct: number;
    items: Array<{
      questionId: number;
      text: string;
      choices: string[];
      correctIndex: number;
      selectedIndex: number | null;
      correct: boolean;
      topic?: string | null;
      difficulty?: number | string | null;
      type?: string | null;
      timeTakenSeconds?: number | null;
    }>;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pull all attempts from the exam service
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await getAttempts();
        if (alive) setAttempts(rows ?? []);
      } catch {
        if (alive) setAttempts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Store candidate name only (avoid type mismatch)
  const [candidateName, setCandidateName] = useState<string>("");
  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u as any); // keep original state around
        setCandidateName(String((u as any)?.name ?? ""));
      })
      .catch(() => setCandidateName(""));
  }, []);

  // Load bank questions (for topics list)
  useEffect(() => {
    let alive = true;
    getQuestions({ topic: "" })
      .then((qs) => {
        if (alive) setQuestions(qs ?? []);
      })
      .catch(() => {
        if (alive) setQuestions([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Get attempts for the current candidate only
  const candidateAttempts = useMemo<ExamAttempt[]>(() => {
    if (!candidateName) return attempts;
    return attempts.filter(
      (a: any) => a.candidate === candidateName || a.userName === candidateName
    );
  }, [attempts, candidateName]);

  // Pick the selected attempt from dropdown (string id)
  const selectedAttempt = useMemo<ExamAttempt | null>(() => {
    const id = selectedAttemptId;
    return (
      candidateAttempts.find(
        (a: any) => String(a.attemptId ?? a.id) === String(id)
      ) ??
      candidateAttempts[0] ??
      null
    );
  }, [candidateAttempts, selectedAttemptId]);

  // topics available in the bank (normalized)
  const topics = useMemo<string[]>(
    () =>
      Array.from(
        new Set(questions.map((q) => normalizetopic((q as any).topic)))
      ).sort(),
    [questions]
  );

  // Overall candidate performance summary
  const candidateStats = useMemo(() => {
    const totalAttempts = candidateAttempts.length;

    const totalQuestions = candidateAttempts.reduce(
      (sum: number, a: ExamAttempt) => sum + a.items.length,
      0
    );

    const correctAnswers = candidateAttempts.reduce(
      (sum: number, a: ExamAttempt) =>
        sum + a.items.filter((i) => i.correct).length,
      0
    );

    const avgScore =
      candidateAttempts.length > 0
        ? Math.round(
            candidateAttempts.reduce(
              (sum: number, a: ExamAttempt) =>
                sum +
                (a.items.filter((i) => i.correct).length / a.items.length) *
                  100,
              0
            ) / candidateAttempts.length
          )
        : 0;

    const overallAccuracy =
      totalQuestions > 0
        ? Math.round((correctAnswers / totalQuestions) * 100)
        : 0;

    return {
      totalAttempts,
      avgScore,
      totalQuestions,
      correctAnswers,
      overallAccuracy,
    };
  }, [candidateAttempts]);

  /* ---------------- DB truth loader (attemptId from URL or latest finished) ---------------- */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams(window.location.search);
        const idFromUrl = params.get("attemptId");
        let sessionId: number | null = idFromUrl ? Number(idFromUrl) : null;

        // Fallback: latest finished attempt from the attempts list
        if (!sessionId || !Number.isFinite(sessionId)) {
          const finished = (attempts ?? []).filter(
            (a) => (a as any).finishedAt || (a as any).finished_at
          );
          finished.sort(
            (a: any, b: any) =>
              new Date(b.finishedAt ?? b.finished_at ?? 0).getTime() -
              new Date(a.finishedAt ?? a.finished_at ?? 0).getTime()
          );
          sessionId = finished[0]
            ? Number((finished[0] as any).attemptId ?? (finished[0] as any).id)
            : null;
        }

        if (!sessionId) throw new Error("No finished exam found.");

        // Pull questions + answers from DB
        const [qsRaw, ansRaw] = await Promise.all([
          getSessionQuestions(sessionId),
          getSessionAnswers(sessionId),
        ]);

        const qnorm = (qsRaw ?? []).map((q: any) => ({
          id: Number(q.questionId ?? q.id),
          text: q.questionText ?? q.text ?? q.question_text ?? q.prompt ?? "",
          choices: (q.choices ?? q.options ?? []).slice(),
          correctIndex: Number(
            q.correctIndex ??
              q.correct_index ??
              q.correct_option ??
              q.correctAnswer ??
              q.correct_answer ??
              0
          ),
          topic: q.topic ?? q.subject ?? q.category ?? q.tags?.[0] ?? null,
          difficulty: q.difficulty ?? q.numericDifficulty ?? null,
          type: (q.type ?? "MCQ") as string,
        }));

        const answers = new Map<
          number,
          { selectedIndex: number; timeTakenSeconds?: number | null }
        >(
          (ansRaw ?? []).map((a: any) => [
            Number(a.questionId ?? a.qid ?? a.question_id),
            {
              selectedIndex: Number(
                a.selectedIndex ?? a.answer_index ?? a.selected_index ?? -1
              ),
              timeTakenSeconds:
                a.timeTakenSeconds ?? a.time_taken_seconds ?? null,
            },
          ])
        );

        const items = qnorm.map((q) => {
          const sel = answers.get(q.id);
          return {
            questionId: q.id,
            text: q.text,
            choices: q.choices,
            correctIndex: q.correctIndex,
            selectedIndex: sel ? sel.selectedIndex : null,
            correct: sel != null && sel.selectedIndex === q.correctIndex,
            topic: q.topic,
            difficulty: q.difficulty,
            type: q.type,
            timeTakenSeconds: sel?.timeTakenSeconds ?? null,
          };
        });

        const correct = items.filter((i) => i.correct).length;

        if (!alive) return;
        setReport({ sessionId, total: qnorm.length, correct, items });

        // Preselect this attempt in the dropdown
        setSelectedAttemptId(String(sessionId));
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load results.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [attempts]); // <<— IMPORTANT: rerun when attempts arrive

  /* --------- Use DB report as the effective attempt for charts/tables (UI unchanged) --------- */

  // Map the DB report to an AttemptRecord shape so downstream UI stays unchanged
  const reportAsAttempt: ExamAttempt | null = useMemo(() => {
    if (!report) return null;

    useEffect(() => {
      console.log({
        attempts,
        candidateAttempts,
        selectedAttemptId,
        report,
      });
    }, [attempts, candidateAttempts, selectedAttemptId, report]);

    return {
      attemptId: String(report.sessionId), // <-- stringify
      candidate: candidateName,
      startedAt: "", // not shown; fine to leave empty
      items: report.items.map((it) => ({
        questionId: it.questionId,
        topic: normalizetopic(typeof it.topic === "string" ? it.topic : null),
        difficulty: toDifficultyLabel(
          typeof it.difficulty === "number"
            ? it.difficulty
            : Number(it.difficulty)
        ),
        type: (it.type as string) || "MCQ",
        correct: !!it.correct,
        timeSpentMs: Math.max(
          0,
          Math.round(
            (typeof it.timeTakenSeconds === "number"
              ? it.timeTakenSeconds
              : 0) * 1000
          )
        ),
      })),
    } as ExamAttempt;
  }, [report, candidateName]);

  // This is what the UI components read everywhere below
  const effectiveAttempt = reportAsAttempt ?? selectedAttempt;

  // Selected attempt: topic accuracy (unchanged UI)
  const topicStats = useMemo(() => {
    if (!effectiveAttempt)
      return [] as { topic: string; correct: number; total: number }[];

    const map: Record<string, { correct: number; total: number }> = {};
    for (const it of effectiveAttempt.items) {
      const k = normalizetopic((it as any).topic as string);
      map[k] = map[k] || { correct: 0, total: 0 };
      map[k].total += 1;
      map[k].correct += it.correct ? 1 : 0;
    }

    return topics.map((s) => ({
      topic: s,
      correct: map[s]?.correct ?? 0,
      total: map[s]?.total ?? 0,
    }));
  }, [effectiveAttempt, topics]);

  // Selected attempt: difficulty accuracy (unchanged UI)
  const difficultyStats = useMemo(() => {
    if (!effectiveAttempt) return [] as { label: string; accuracy: number }[];
    const order = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"] as const;
    return order.map((d) => {
      const items = effectiveAttempt.items.filter(
        (i: any) => i.difficulty === d
      );
      const acc = items.length
        ? Math.round(
            (items.filter((i) => i.correct).length / items.length) * 100
          )
        : 0;
      return { label: d, accuracy: acc };
    });
  }, [effectiveAttempt]);

  // Running accuracy time series (unchanged UI)
  const timeSeries = useMemo(() => {
    if (!effectiveAttempt)
      return { labels: [] as string[], scores: [] as number[] };
    const labels = effectiveAttempt.items.map(
      (_, idx: number) => `Q${idx + 1}`
    );
    const accProgress = effectiveAttempt.items.map((i) => (i.correct ? 1 : 0));
    const cum: number[] = [];
    let sum: number = 0;
    for (let i = 0; i < accProgress.length; i++) {
      sum += accProgress[i];
      cum.push(Math.round((sum / (i + 1)) * 100));
    }
    return { labels, scores: cum };
  }, [effectiveAttempt]);

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

  // Keep empty-state only if neither DB report nor candidate attempts exist
  if (!reportAsAttempt && !candidateAttempts.length) {
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

  // Everything below is unchanged UI; it now reads from `effectiveAttempt`
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
              onChange={(e) => setSelectedAttemptId(e.target.value || null)}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744] transition-colors custom-select"
              style={{ color: "#374151" }}
            >
              <option value="">Choose an attempt...</option>
              {candidateAttempts.map((a: any, index: number) => (
                <option
                  key={String(a.attemptId ?? a.id)}
                  value={String(a.attemptId ?? a.id)}
                >
                  Attempt #{index + 1} —{" "}
                  {new Date(
                    a.startedAt ??
                      a.started_at ??
                      a.finishedAt ??
                      a.finished_at ??
                      Date.now()
                  ).toLocaleDateString()}{" "}
                  ({a.items?.length ?? a.total_questions ?? 0} questions)
                </option>
              ))}
              {/* If the DB report’s sessionId isn’t in candidateAttempts, still show it */}
              {report &&
                !candidateAttempts.some(
                  (a) => String(a.attemptId) === String(report.sessionId)
                ) && (
                  <option value={String(report.sessionId)}>
                    Attempt (from DB) — {report.total} questions
                  </option>
                )}
            </select>
          </div>
        </div>

        {/* Attempt-specific insights */}
        {effectiveAttempt && (
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
                    data={{
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
                    }}
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
                    data={{
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
                    }}
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
                    {effectiveAttempt?.items.map((it: any, idx: number) => (
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
                          {normalizetopic(it.topic as string)}
                        </td>
                        <td className="p-4">
                          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {it.difficulty}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#ff7a59]/10 text-[#ff7a59]">
                            {it.type}
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
                    {(!effectiveAttempt ||
                      effectiveAttempt.items.length === 0) && (
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
