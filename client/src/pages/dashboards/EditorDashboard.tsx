// client/src/pages/dashboards/EditorDashboard.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getQuestions } from "../../services/questionService";
import type { Question } from "../../types/question";

export default function EditorDashboard() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [topic, setTopic] = useState<string>("");
  const [difficulty, setDifficulty] = useState<number>(3); // 1..5
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      const qs = await getQuestions({ topic: t, difficulty });
      setQuestions(qs ?? []);
    } catch (e: any) {
      setQuestions([]);
      setErr(e?.message ?? "Failed to load questions");
      // Optional: console.error("getQuestions failed:", e?.status, e?.message, e?.payload ?? e);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      pending: questions.filter((q) => q.status === "pending").length,
      draft: questions.filter((q) => q.status === "draft").length,
      approved: questions.filter((q) => q.status === "approved").length,
      rejected: questions.filter((q) => q.status === "rejected").length,
    }),
    [questions]
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
        <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
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
            <label className="text-xs text-gray-600 mb-1">Difficulty (1–5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDifficulty(Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3);
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
        {[
          {
            label: "Pending",
            value: counts.pending,
            tone: "bg-amber-50 text-amber-700 border-amber-200",
          },
          {
            label: "Drafts",
            value: counts.draft,
            tone: "bg-gray-50 text-gray-700 border-gray-200",
          },
          {
            label: "Approved",
            value: counts.approved,
            tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
          },
          {
            label: "Rejected",
            value: counts.rejected,
            tone: "bg-rose-50 text-rose-700 border-rose-200",
          },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-lg border ${k.tone.split(" ").at(-1)} bg-white p-5 shadow-sm`}
          >
            <div className={`h-1 w-full rounded ${k.tone.split(" ")[0]}`} />
            <div className="mt-3 text-xs text-gray-600">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f2744]">
              {k.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
