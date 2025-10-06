// client/src/pages/dashboards/EditorDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getQuestions } from "../../services/questionService";
import type { Question } from "../../types/question";
import { getActivityFeed, type ActivityItem } from "../../services/activity";

type Counts = {
  pending: number;
  approved: number;
  rejected: number;
};

export default function EditorDashboard() {
  const [topic, setTopic] = useState<string>("");
  const [difficulty, setDifficulty] = useState<number>(3); // 1..5
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<ActivityItem[]>([]);

  // we keep a small sample list just in case you want to show a preview later
  const [sampleQuestions, setSampleQuestions] = useState<Question[]>([]);
  const [counts, setCounts] = useState<Counts>({
    pending: 0,
    approved: 0,
    rejected: 0,
  });

  // load editor-scoped activity
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const items = await getActivityFeed("editor", {
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = topic.trim();
    if (!t) {
      setErr("Please enter a topic");
      return;
    }
    setErr(null);
    setLoading(true);

    try {
      // 1) Try status-scoped fetches first (preferred)
      const [pendingRes, draftRes, approvedRes, rejectedRes] =
        await Promise.all([
          getQuestions({ topic: t, difficulty, status: "pending" }).catch(
            () => [] as Question[]
          ),
          getQuestions({ topic: t, difficulty, status: "draft" }).catch(
            () => [] as Question[]
          ),
          // API uses "published" for approved questions
          getQuestions({ topic: t, difficulty, status: "published" }).catch(
            () => [] as Question[]
          ),
          getQuestions({ topic: t, difficulty, status: "rejected" }).catch(
            () => [] as Question[]
          ),
        ]);

      // 2) If the API didn’t support a status, fall back to a blended fetch and count by q.status
      let fallbackAll: Question[] = [];
      if (
        pendingRes.length +
          draftRes.length +
          approvedRes.length +
          rejectedRes.length ===
        0
      ) {
        fallbackAll =
          (await getQuestions({ topic: t, difficulty }).catch(
            () => [] as Question[]
          )) ?? [];
      }

      const pendingCount =
        pendingRes.length ||
        draftRes.length ||
        fallbackAll.filter(
          (q: any) =>
            q.status === "pending" ||
            q.status === "draft" ||
            q.state === "pending" ||
            q.state === "draft"
        ).length;

      const approvedCount =
        approvedRes.length ||
        fallbackAll.filter(
          (q: any) =>
            q.status === "approved" ||
            q.status === "published" ||
            q.state === "approved" ||
            q.state === "published"
        ).length;

      const rejectedCount =
        rejectedRes.length ||
        fallbackAll.filter(
          (q: any) => q.status === "rejected" || q.state === "rejected"
        ).length;

      setCounts({
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      });

      // keep a small sample so the page could later show a preview if needed
      setSampleQuestions(
        approvedRes.slice(0, 10).length > 0
          ? approvedRes.slice(0, 10)
          : fallbackAll.slice(0, 10) ?? []
      );
    } catch (e: any) {
      setCounts({ pending: 0, approved: 0, rejected: 0 });
      setSampleQuestions([]);
      setErr(e?.message ?? "Failed to load questions");
    } finally {
      setLoading(false);
    }
  }

  const cards = useMemo(
    () => [
      {
        label: "Pending",
        value: counts.pending,
        toneBg: "bg-amber-50",
        toneBorder: "border-amber-200",
        toneText: "text-amber-700",
      },
      {
        label: "Approved",
        value: counts.approved,
        toneBg: "bg-emerald-50",
        toneBorder: "border-emerald-200",
        toneText: "text-emerald-700",
      },
      {
        label: "Rejected",
        value: counts.rejected,
        toneBg: "bg-rose-50",
        toneBorder: "border-rose-200",
        toneText: "text-rose-700",
      },
    ],
    [counts]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0f2744]/5 px-3 py-1 text-xs font-medium text-[#0f2744]">
              Editor
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[#0f2744]">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Create, review, and approve exam content.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/app/ai-generator"
              className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Create questions
            </Link>
            <Link
              to="/app/questions"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Question bank
            </Link>
          </div>
        </div>

        {/* Query form (topic + difficulty) */}
        <form
          onSubmit={onSubmit}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Topic</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Algorithms"
              className="border border-gray-300 rounded-md px-3 py-2 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-[#0f2744]/30"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">
              Difficulty (1–5)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDifficulty(
                  Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3
                );
              }}
              className="border border-gray-300 rounded-md px-3 py-2 w-24 focus:outline-none focus:ring-2 focus:ring-[#0f2744]/30"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {loading ? "Loading..." : "Load"}
          </button>

          {err && <span className="text-sm text-rose-600">{err}</span>}
        </form>
      </div>

      {/* Content status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((k) => (
          <div
            key={k.label}
            className={`rounded-lg border ${k.toneBorder} bg-white p-5 shadow-sm`}
          >
            <div className={`h-1 w-full rounded ${k.toneBg}`} />
            <div className={`mt-3 text-xs ${k.toneText}`}>{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f2744]">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-medium text-[#0f2744]">Recent activity</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {recent.slice(0, 10).map((x) => (
            <li
              key={x.id}
              className="flex items-center gap-3 rounded border border-gray-100 bg-gray-50 px-3 py-2"
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
            <li className="rounded border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-gray-500">
              No recent activity.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
