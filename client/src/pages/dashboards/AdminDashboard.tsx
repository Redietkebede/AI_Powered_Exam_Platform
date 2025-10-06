import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getAnalyticsSummary,
  getAnalyticsOverview,
} from "../../services/analytics";
import { getActivityFeed, type ActivityItem } from "../../services/activity";

function readDefaultTopic(): string {
  try {
    const stored = (
      localStorage.getItem("active.topic") ||
      sessionStorage.getItem("active.topic") ||
      ""
    ).trim();
    if (stored) return stored;
  } catch {}
  return (import.meta.env.VITE_DEFAULT_TOPIC || "").trim();
}

export default function AdminDashboard() {
  const [topic, setTopic] = useState<string>(readDefaultTopic());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [recent, setRecent] = useState<ActivityItem[]>([]);

  // load activity once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await getActivityFeed("admin", {
          sinceDays: 30,
          limit: 50,
        });
        if (alive) setRecent(items);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  // auto-load when we already have a topic (from localStorage or env)
  useEffect(() => {
    if (!summary && !loading) {
      load(topic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(t: string) {
    const tt = (t || "").trim(); // topic the admin typed; may be ""
    setLoading(true);
    setError(null);

    // 1) Pull the server overview (works for any role)
    const o = await getAnalyticsOverview(t ? { topic: t } : {});

    // 2) adapt to the local shape used by this page
    const s = {
      kpis: {
        candidates: Number(o.candidates ?? 0),
        exams: Number(o.examsTaken ?? 0),
        avgScore: Number(o.avgScore ?? 0),
        questions: Number(o.questions ?? 0),
      },
      timeline: (o.performanceOverTime ?? []).map((r) => ({
        label: r.label,
        score: r.score,
      })),
      byDifficulty: (o.scoresByDifficulty ?? []).map((r) => ({
        label: String(r.difficulty),
        score: Number(r.accuracy_pct ?? 0),
      })),
    };

    // 3) keep your existing fallback logic
    const exams = s.kpis.exams;
    const candidates = s.kpis.candidates;
    const questions = s.kpis.questions;

    if (t && exams === 0 && candidates === 0 && questions === 0) {
      const g = await getAnalyticsOverview({});
      setSummary({
        kpis: {
          candidates: Number(g.candidates ?? 0),
          exams: Number(g.examsTaken ?? 0),
          avgScore: Number(g.avgScore ?? 0),
          questions: Number(g.questions ?? 0),
        },
        timeline: (g.performanceOverTime ?? []).map((r) => ({
          label: r.label,
          score: r.score,
        })),
        byDifficulty: (g.scoresByDifficulty ?? []).map((r) => ({
          label: String(r.difficulty),
          score: Number(r.accuracy_pct ?? 0),
        })),
      });
      try {
        localStorage.removeItem("active.topic");
      } catch {}
    } else {
      setSummary(s);
      try {
        if (t) localStorage.setItem("active.topic", t);
        else localStorage.removeItem("active.topic");
      } catch {}
    }
  }

  const kpis = useMemo(() => {
    // Support both shapes: {kpis:{...}} and top-level {...}
    const k = (summary as any)?.kpis ?? {};
    return [
      { label: "Active Candidates", value: Number(k.candidates ?? 0) },
      { label: "Exams Taken", value: Number(k.exams ?? k.examsTaken ?? 0) },
      { label: "Avg Score", value: `${Number(k.avgScore ?? 0)}%` },
      { label: "Question Bank", value: Number(k.questions ?? 0) },
    ];
  }, [summary]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0f2744]/5 px-3 py-1 text-xs font-medium text-[#0f2744]">
              Admin
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[#0f2744]">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage users, content, and insights across the platform.
            </p>
          </div>

          {/* Topic + actions */}
          <div className="flex items-center gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load(topic);
              }}
              placeholder="Topic (e.g., Algorithms)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
            />
            <button
              onClick={() => load(topic)}
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Loading…" : "Apply"}
            </button>
            <Link
              to="/app/users"
              className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Create user
            </Link>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {/* KPIs */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="h-1 w-full rounded bg-[#ff7a59]" />
            <div className="mt-3 text-xs text-gray-600">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f2744]">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">User Management</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">
              Access
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Create accounts and set role permissions.
          </p>
          <Link
            to="/app/users"
            className="mt-4 inline-block rounded-md bg-[#ff7a59] px-4 py-2 text-white text-sm hover:brightness-110"
          >
            Open
          </Link>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Analytics</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">
              Insights
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Track performance, timing, and outcomes.
          </p>
          <Link
            to={`/app/analytics${
              topic ? `?topic=${encodeURIComponent(topic)}` : ""
            }`}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
          >
            View
          </Link>
        </div>
      </div>

      {/* Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-medium text-[#0f2744]">Recent activity</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {recent.map((x) => (
            <li
              key={x.id}
              className="flex items-center gap-3 rounded-md border border-gray-200 bg-white/60 px-3 py-2"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "#ff7a59" }}
              />
              <span className="text-gray-800">{x.message}</span>
              <span className="ml-auto text-xs text-gray-500">
                {new Date(x.created_at).toLocaleString()}
              </span>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="text-sm text-gray-500">No recent activity</li>
          )}
        </ul>
      </div>
    </div>
  );
}
