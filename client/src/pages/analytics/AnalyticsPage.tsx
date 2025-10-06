// client/src/pages/analytics/AnalyticsPage.tsx
import { useMemo, useState, useEffect } from "react";
import { Bar, Line } from "react-chartjs-2";
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
  getAnalyticsOverview,
  type AnalyticsOverview,
  type AnalyticsFilters,
} from "../../services/analytics";

import { ShieldAlert, Users, Trophy, Activity, Filter } from "lucide-react";
import { getCurrentUser } from "../../services/userService";

const DEBUG_UI = true; // flip to false later

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement, 
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

type Role = "admin" | "editor" | "recruiter" | "candidate";

export default function AnalyticsPage() {
  /** ─────────────────── Access control ─────────────────── */
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await getCurrentUser(); // { id, role, ... }
        if (alive) setRole(me.role);
        if (DEBUG_UI) console.debug("[AnalyticsPage] role ←", me.role);
      } catch {
        if (alive) setRole(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const isAllowed = role === "admin" || role === "recruiter";

  /** ─────────────────── Filters & static lists ─────────────────── */
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [summary, setSummary] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  // derive testId from query (?testId=123)
  const params = new URLSearchParams(window.location.search);
  const testId = Number(params.get("testId") ?? "");
  const testIdOrUndefined = Number.isFinite(testId) ? testId : undefined;

  // Topics come from the current summary payload (labels only)
  const topics = useMemo<string[]>(
    () => (summary?.topicInsights ?? []).map((t: any) => t.topic),
    [summary]
  );

  // Candidate dropdown options — keep empty (you can wire a list later)
  const candidateOptions: string[] = [];

  /** ─────────────────── Analytics data (safe) ─────────────────── */

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const out = {
          testId: testIdOrUndefined,
          candidateId: (filters as any).candidate ?? undefined,
          topic: filters.topic || undefined,
          difficulty: filters.difficulty || undefined,
        };
        if (DEBUG_UI) console.debug("[AnalyticsPage] filters →", out);

        const raw = await getAnalyticsOverview(out);

        // reuse your helper
        const normalizeOverview = (d: any) => {
          if (!d) return d;
          if (!d.scoresByDifficulty && Array.isArray(d.byDifficulty)) {
            d.scoresByDifficulty = d.byDifficulty.map((x: any) => ({
              difficulty: String(x.difficulty),
              accuracy_pct: Number(x.accuracy_pct) || 0,
            }));
          }
          if (
            !Array.isArray(d.performanceOverTime) &&
            Array.isArray(d.timeline)
          ) {
            d.performanceOverTime = d.timeline;
          }
          return d;
        };

        const d = normalizeOverview(raw);

        if (DEBUG_UI) {
          console.debug("[AnalyticsPage] overview ←", d);
          console.debug("[AnalyticsPage] charts len", {
            timeline: d.performanceOverTime?.length ?? 0,
            byDifficulty: d.scoresByDifficulty?.length ?? 0,
            topicInsights: d.topicInsights?.length ?? 0,
            timeSpentSeconds: d.timeSpentSeconds?.length ?? 0,
          });
        }

        if (alive) setSummary(d);
      } catch (e) {
        if (DEBUG_UI) console.debug("[AnalyticsPage] overview error", e);
        if (alive) setSummary(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // IMPORTANT: refetch when the UI "candidate" changes (not candidateId)
  }, [
    (filters as any).candidate,
    filters.topic,
    filters.difficulty,
    testIdOrUndefined,
  ]);

  // normalize overview shape (supports both scoresByDifficulty and byDifficulty)
  const normalizeOverview = (d: any) => {
    if (!d) return d;
    if (!d.scoresByDifficulty && Array.isArray(d.byDifficulty)) {
      d.scoresByDifficulty = d.byDifficulty.map((x: any) => ({
        difficulty: String(x.difficulty),
        accuracy_pct: Number(x.accuracy_pct) || 0,
      }));
    }
    if (!Array.isArray(d.performanceOverTime) && Array.isArray(d.timeline)) {
      d.performanceOverTime = d.timeline; // tolerate alt key
    }
    return d;
  };

  // SAFE fallbacks mapped to the new API shape
  const kpis = {
    candidates: summary?.candidates ?? 0,
    exams: summary?.examsTaken ?? 0,
    avgScore: summary?.avgScore ?? 0,
    questions: summary?.questions ?? 0,
  };

  // charts data (typed to silence implicit-any)
  const safeTimeline: Array<{ label: string; score: number }> =
    summary?.performanceOverTime ?? [];

  const safeByDifficulty: Array<{ difficulty: string; accuracy_pct: number }> =
    summary?.scoresByDifficulty ?? [];

  // simple “histogram” from seconds list
  const safeTimeHist = {
    labels: (summary?.timeSpentSeconds ?? []).map((_, i) => `A${i + 1}`),
    counts: summary?.timeSpentSeconds ?? [],
  };

  // topic table rows
  const topicStats: Array<{
    topic: string;
    accuracy: number;
    avgTimeSec: number;
  }> = (summary?.topicInsights ?? []).map((t) => ({
    topic: t.topic,
    accuracy: Math.round(t.accuracy_pct || 0),
    avgTimeSec: 0, // server doesn't provide avg time per topic (yet)
  }));

  // Sections not provided by the API yet – keep as empty lists for now
  const safeTopPerformers: Array<{
    candidate: string;
    lastActive?: string;
    score?: number;
    attempts?: number;
  }> = [];
  const safeRecent: Array<{
    candidate: string;
    date: string;
    score?: number;
    correct?: number;
    total?: number;
  }> = [];

  if (DEBUG_UI) {
    console.debug("[AnalyticsPage] render.kpis", kpis);
    console.debug("[AnalyticsPage] render.counts", {
      timeline: safeTimeline.length,
      byDifficulty: safeByDifficulty.length,
      topics: topicStats.length,
      timeBuckets: safeTimeHist.counts.length,
    });
  }

  /** ─────────────────── Charts (derived) ─────────────────── */
  const lineData = useMemo(() => {
    return {
      labels: safeTimeline.map(
        (t: { label: string; score: number }) => t.label
      ),
      datasets: [
        {
          label: "Average Score",
          data: safeTimeline.map(
            (t: { label: string; score: number }) => t.score
          ),
          borderColor: "#ff7a59",
          backgroundColor: "rgba(255,122,89,0.1)",
          borderWidth: 3,
          tension: 0.4,
        },
      ],
    };
  }, [safeTimeline]);

  const barData = useMemo(() => {
    return {
      labels: safeByDifficulty.map(
        (b: { difficulty: string; accuracy_pct: number }) => b.difficulty
      ),
      datasets: [
        {
          label: "Avg Score",
          data: safeByDifficulty.map(
            (b: { difficulty: string; accuracy_pct: number }) =>
              Math.round(b.accuracy_pct || 0)
          ),
          backgroundColor: [
            "#ffd2c6",
            "#ffc3b0",
            "#ffa894",
            "#ff947d",
            "#ff7a59",
          ],
        },
      ],
    };
  }, [safeByDifficulty]);

  const timeHistData = useMemo(
    () => ({
      labels: safeTimeHist.labels,
      datasets: [
        {
          label: "Count",
          data: safeTimeHist.counts,
          backgroundColor: "#ff7a59",
          borderRadius: 6,
        },
      ],
    }),
    [safeTimeHist]
  );

  /** ─────────────────── Guarded access ─────────────────── */
  if (!isAllowed) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-orange-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            Access Restricted
          </h2>
          <p className="text-gray-600">
            Analytics are available to admins and recruiters only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center mb-8">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center mr-4">
          <svg
            className="w-7 h-7 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            Analytics Dashboard
          </h1>
          <p className="text-gray-600 mt-1">
            Comprehensive insights and performance metrics
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Candidates",
            value: kpis.candidates,
            icon: Users,
            bgColor: "from-blue-50 to-blue-100",
            borderColor: "border-blue-200",
            textColor: "text-blue-600",
          },
          {
            label: "Exams Taken",
            value: kpis.exams,
            icon: Activity,
            bgColor: "from-orange-50 to-orange-100",
            borderColor: "border-orange-200",
            textColor: "text-orange-600",
          },
          {
            label: "Avg Score",
            value: `${kpis.avgScore}%`,
            icon: Trophy,
            bgColor: "from-green-50 to-green-100",
            borderColor: "border-green-200",
            textColor: "text-green-600",
          },
          {
            label: "Questions",
            value: kpis.questions,
            icon: Trophy,
            bgColor: "from-purple-50 to-purple-100",
            borderColor: "border-purple-200",
            textColor: "text-purple-600",
          },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-1">
                    {k.label}
                  </div>
                  <div className="text-2xl font-bold text-gray-800">
                    {k.value}
                  </div>
                </div>
                <div
                  className={`w-12 h-12 bg-gradient-to-br ${k.bgColor} rounded-xl flex items-center justify-center border ${k.borderColor}`}
                >
                  <Icon className={`w-6 h-6 ${k.textColor}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
          <Filter className="w-5 h-5 text-orange-600 mr-2" />
          Filters
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Candidate
            </label>
            <select
              value={(filters as any).candidate ?? ""}
              onChange={(e) => {
                const v = e.target.value || undefined;
                if (DEBUG_UI)
                  console.debug("[AnalyticsPage] setFilters.candidate", v);
                setFilters((f) => ({ ...(f as any), candidate: v }));
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All candidates</option>
              {candidateOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              topic
            </label>
            <select
              value={filters.topic ?? ""}
              onChange={(e) => {
                const v = e.target.value || undefined;
                if (DEBUG_UI)
                  console.debug("[AnalyticsPage] setFilters.topic", v);
                setFilters((f) => ({ ...f, topic: v }));
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All topics</option>
              {topics.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Difficulty
            </label>
            <select
              value={(filters.difficulty as any) ?? ""}
              onChange={(e) => {
                const v = (e.target.value as any) || undefined;
                if (DEBUG_UI)
                  console.debug("[AnalyticsPage] setFilters.difficulty", v);
                setFilters((f) => ({ ...f, difficulty: v }));
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All difficulties</option>
              {["Very Easy", "Easy", "Medium", "Hard", "Very Hard"].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{kpis.exams}</span> exams ·
            <span className="font-medium"> {kpis.candidates}</span> candidates ·
            <span className="font-medium"> {kpis.avgScore}%</span> avg score
          </div>
          <button
            onClick={() => setFilters({})}
            className="rounded-xl border border-orange-200 text-orange-700 px-4 py-2 text-sm font-medium hover:bg-orange-50 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <svg
              className="w-4 h-4 text-orange-600 mr-2"
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
            Performance Over Time
          </h3>
          <div className="mt-4">
            <Line
              data={lineData}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: "rgba(0,0,0,0.05)" },
                  },
                  x: { grid: { color: "rgba(0,0,0,0.05)" } },
                },
              }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <svg
              className="w-4 h-4 text-orange-600 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2z"
              />
            </svg>
            Scores by Difficulty
          </h3>
          <div className="mt-4">
            <Bar
              data={barData}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: "rgba(0,0,0,0.05)" },
                  },
                  x: { grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* topic and time insights */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <svg
              className="w-4 h-4 text-orange-600 mr-2"
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
            topic Insights
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left p-3 font-semibold text-gray-800">
                    topic
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-800">
                    Accuracy
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-800">
                    Avg Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {(topicStats ?? []).map((row: any, index: number) => (
                  <tr
                    key={row.topic}
                    className={`border-b border-gray-100 ${
                      index % 2 === 0 ? "bg-gray-50" : "bg-white"
                    }`}
                  >
                    <td className="p-3 font-medium text-gray-800">
                      {row.topic}
                    </td>
                    <td className="p-3">
                      <span
                        className={`font-bold text-lg ${
                          row.accuracy >= 70
                            ? "text-green-600"
                            : row.accuracy >= 50
                            ? "text-orange-600"
                            : "text-red-600"
                        }`}
                      >
                        {row.accuracy}%
                      </span>
                    </td>
                    <td className="p-3 text-gray-700">{row.avgTimeSec}s</td>
                  </tr>
                ))}
                {(topicStats ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-gray-500">
                      No data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <svg
              className="w-4 h-4 text-orange-600 mr-2"
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
            Time Spent Distribution
          </h3>
          <div className="mt-4">
            <Bar
              data={timeHistData}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" } },
                  x: { grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* Top performers and recent activity */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <Trophy className="w-4 h-4 text-orange-600 mr-2" />
            Top Performers
          </h3>
          <div className="space-y-4">
            {safeTopPerformers.map((p, index) => (
              <div
                key={(p.candidate ?? index) + ""}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm mr-3 ${
                      index === 0
                        ? "bg-yellow-500"
                        : index === 1
                        ? "bg-gray-400"
                        : index === 2
                        ? "bg-orange-500"
                        : "bg-gray-300"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium text-gray-800">
                      {p.candidate}
                    </div>
                    <div className="text-sm text-gray-600">
                      {p.attempts} attempts
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-orange-600 text-lg">
                    {p.score}%
                  </div>
                  <div className="text-xs text-gray-500">{p.lastActive}</div>
                </div>
              </div>
            ))}
            {safeTopPerformers.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No performance data available
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <Activity className="w-4 h-4 text-orange-600 mr-2" />
            Recent Activity
          </h3>
          <div className="space-y-4">
            {safeRecent.map((activity, index) => (
              <div
                key={`${activity.candidate ?? "unknown"}-${
                  activity.date ?? index
                }`}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-gray-800">
                    {activity.candidate}
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(activity.date).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-orange-600">
                    {activity.score}%
                  </div>
                  <div className="text-xs text-gray-500">
                    {activity.correct}/{activity.total}
                  </div>
                </div>
              </div>
            ))}
            {(safeRecent ?? []).length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center text-sm text-gray-500">Loading…</div>
      )}
    </div>
  );
}
