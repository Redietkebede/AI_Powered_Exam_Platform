import { Link } from "react-router-dom";
import { getAnalyticsDetails,getAnalyticsOverview } from "../../services/analytics";
import { getActivityFeed, type ActivityItem } from "../../services/activity";
import {
  Users,
  Activity,
  Trophy,
  ClipboardList,
  ArrowRight,
  PlusCircle,
  CalendarDays,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getPublishedTopics } from "../../services/questionService";

/** NOTE:
 * We only read a few fields on this page. To avoid brittle typing when the
 * analytics service shape evolves, we type the state as `any` and keep a
 * robust, fully-populated default. This removes the TS error you saw without
 * changing UI/UX or the analytics function.
 */

type AnalyticsSummary = Awaited<ReturnType<typeof getAnalyticsDetails>>;

const DEFAULT_SUMMARY: any = {
  kpis: {
    candidates: 0,
    exams: 0,
    avgScore: 0,
    questions: 0,
  },
  timeline: [],
  byDifficulty: [],
  byDifficultyCounts: {
    "Very Easy": 0,
    Easy: 0,
    Medium: 0,
    Hard: 0,
    "Very Hard": 0,
  },
  topPerformers: [],
  recentActivity: [],
  topicStats: [],
  timeHistogram: [],
  candidateProgression: [],
};

export default function RecruiterDashboard() {
  // Type as `any` to stay resilient to analytics payload changes,
  // while keeping UI strictly the same.
  const [summary, setSummary] = useState<any>(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    (async () => {
      // inside the initial effect where summary is loaded
      try {
        const o = await getAnalyticsOverview({});
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
        if (alive) setSummary(s as any);
      } catch {
        if (alive) setSummary(DEFAULT_SUMMARY);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // Load recruiter activity (last 7 days)
    (async () => {
      try {
        const items = await getActivityFeed("recruiter", {
          sinceDays: 30,
          limit: 50,
        });
        if (alive) setRecent(items);
      } catch {}
    })();

    // Warm up topics endpoint used by Assignments flow (no UI change).
    (async () => {
      try {
        await getPublishedTopics();
      } catch {
        /* ignore prefetch errors */
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-gray-500">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff7a59] to-[#ff6b4a] text-white shadow-sm">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0f2744]">
                Recruiter Dashboard
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Assign assessments, schedule windows, and track outcomes.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to="/app/assignments"
              className="inline-flex items-center gap-2 rounded-xl bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              <PlusCircle className="h-4 w-4" /> New Assignment
            </Link>
            <Link
              to="/app/analytics"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              <ArrowRight className="h-4 w-4" /> View Analytics
            </Link>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Candidates",
            value: summary.kpis?.candidates ?? 0,
            icon: Users,
            tone: "bg-[#0f2744]/10 text-[#0f2744]",
          },
          {
            label: "Exams Taken",
            value: summary.kpis?.exams ?? 0,
            icon: Activity,
            tone: "bg-[#ff7a59]/10 text-[#ff7a59]",
          },
          {
            label: "Avg Score",
            value: `${summary.kpis?.avgScore ?? 0}%`,
            icon: Trophy,
            tone: "bg-[#0f2744]/10 text-[#0f2744]",
          },
          {
            label: "Question Bank",
            value: summary.kpis?.questions ?? 0,
            icon: ClipboardList,
            tone: "bg-[#ff7a59]/10 text-[#ff7a59]",
          },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600">{k.label}</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f2744]">
                    {k.value}
                  </div>
                </div>
                <div
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${k.tone}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions + small panels */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Schedule</h3>
            <CalendarDays className="h-4 w-4 text-[#0f2744]" />
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Plan windows and track upcoming sessions.
          </p>
          <Link
            to="/app/assignments"
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Manage <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-medium text-[#0f2744]">Recent Activity</h3>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
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
