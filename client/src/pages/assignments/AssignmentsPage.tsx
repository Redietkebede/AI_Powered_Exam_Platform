// client/src/pages/assignments/AssignmentsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Trash2 } from "lucide-react";

import { getUsers } from "../../services/userService";
import { getQuestions } from "../../services/questionService";
import {
  createAssignmentSvc,
  getAssignmentsSvc,
  deleteAssignmentSvc,
} from "../../services/assignmentService";

import type { Question } from "../../types/question";

/* -------------------------------------------------------
   Helpers & Local Types
------------------------------------------------------- */

type UserRole = "admin" | "editor" | "recruiter" | "candidate";
type User = {
  id: number | string;
  name: string;
  email: string;
  role: UserRole;
};

const isCandidate = (u: User) => u.role === "candidate";
const isRecruiter = (u: User) => u.role === "recruiter";

type QType = Question["type"];
type DifficultyLabel = Question["difficulty"]; // kept for typing only

type ExamConfig = {
  topics: string[];
  allowedDifficulties: DifficultyLabel[]; // compatibility; unused in filtering now
  allowedTypes: QType[];
  questionCount: number;
  adaptive: boolean;
  randomizeOrder: boolean;
  timeLimitMinutes?: number;
};

type ScheduleWindow = { startAt?: string; dueAt?: string };

function toTypeLabel(t: unknown): QType {
  const s = String(t ?? "")
    .trim()
    .toUpperCase();
  if (s === "MCQ") return "MCQ";
  return "MCQ";
}

function getTopic(q: any): string {
  return String(q?.topic ?? q?.subject ?? "").trim() || "Uncategorized";
}

function normalizeTopic(s?: string | null): string {
  const v = (s ?? "").trim();
  return v || "Uncategorized";
}

function isAssignable(q: any) {
  // If the question has no status (common for /questions/published), treat it as assignable.
  if (!("status" in (q ?? {}))) return true;

  const st = String(q?.status ?? "").toLowerCase();
  // recruiter can assign only published/approved questions
  return st === "published" || st === "approved";
}

function formatDateTimeLocal(value?: string) {
  if (!value) return "";
  try {
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/* ---------- assignment list normalizers & predicates ---------- */

type AnyRow = Record<string, any>;

const normalizeList = (data: any): AnyRow[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.sessions)) return data.sessions;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  return [];
};

const toSessionId = (row: AnyRow): string | null => {
  const id =
    row.id ?? row.sessionId ?? row.session_id ?? row.session?.id ?? null;
  return id != null ? String(id) : null;
};

const isFinished = (row: AnyRow): boolean => {
  const finished =
    row.finished_at ?? row.finishedAt ?? row.session?.finished_at ?? null;
  const st = String(row.status ?? row.session?.status ?? "").toLowerCase();
  return (
    Boolean(finished) ||
    ["completed", "finished", "closed", "expired"].includes(st)
  );
};

/* -------------------------------------------------------
   Component
------------------------------------------------------- */

export default function AssignmentsPage() {
  const navigate = useNavigate();

  // stepper
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // users
  const [users, setUsers] = useState<User[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [recruiters, setRecruiters] = useState<User[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");

  // assignments
  const [assignments, setAssignments] = useState<AnyRow[]>([]);
  const [viewMode] = useState<"simple" | "detailed">("simple");
  const [density] = useState<"comfortable" | "compact">("comfortable");

  // selection
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
    []
  );

  // questions (published pool for topic/type counts)
  const [questions, setQuestions] = useState<Question[]>([]);
  const [topicQuery, setTopicQuery] = useState("");

  // config (difficulty kept for compatibility but unused for filtering)
  const [config, setConfig] = useState<ExamConfig>({
    topics: [],
    allowedDifficulties: ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"],
    allowedTypes: ["MCQ"],
    questionCount: 10,
    adaptive: true,
    randomizeOrder: true,
    timeLimitMinutes: 30,
  });

  const [schedule, setSchedule] = useState<ScheduleWindow>({
    startAt: "",
    dueAt: "",
  });

  /* ---------------- data loads ---------------- */

  useEffect(() => {
    let alive = true;
    getUsers()
      .then((list) => {
        if (!alive) return;
        const u = (Array.isArray(list) ? list : []) as User[];
        setUsers(u);
        setCandidates(u.filter(isCandidate));
        setRecruiters(u.filter(isRecruiter));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // pull only published (BE enforces; we just ask large limit)
    getQuestions({ status: "published", limit: 1000 })
      .then((qs) => alive && setQuestions(Array.isArray(qs) ? qs : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // load assignments once (normalized)
  useEffect(() => {
    let alive = true;
    getAssignmentsSvc()
      .then((rows) => {
        if (!alive) return;
        setAssignments(normalizeList(rows));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------- derived sets ---------------- */

  // We already query published-only, so no extra filtering needed.
  const allApprovedQuestions = useMemo(() => questions, [questions]);

  // all topics present in published questions
  const topics = useMemo<string[]>(
    () =>
      Array.from(
        new Set(allApprovedQuestions.map((q) => normalizeTopic(getTopic(q))))
      ).sort((a, b) => a.localeCompare(b)),
    [allApprovedQuestions]
  );

  // count of questions per topic given TYPE filter
  const topicCountsByFilter = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of allApprovedQuestions) {
      const typeOk = config.allowedTypes.includes(toTypeLabel((q as any).type));
      if (!typeOk) continue;
      const t = normalizeTopic(getTopic(q));
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [allApprovedQuestions, config.allowedTypes]);

  // pool size preview: topics + type filter (difficulty no longer filters)
  const poolSize = useMemo(() => {
    const selectedTopics = config.topics ?? [];
    const allowedTypes = config.allowedTypes ?? [];
    const allowAllTypes = allowedTypes.length === 0;

    return allApprovedQuestions.filter((q) => {
      const t = normalizeTopic(getTopic(q));
      const okTopic = selectedTopics.length === 0 || selectedTopics.includes(t);
      const typeLabel = toTypeLabel((q as any).type);
      const okType = allowAllTypes || allowedTypes.includes(typeLabel);
      return okTopic && okType;
    }).length;
  }, [allApprovedQuestions, config.topics, config.allowedTypes]);

  // show only "open" assignments
  const openAssignments = useMemo(() => {
    return normalizeList(assignments).filter(
      (r) => !isFinished(r) && toSessionId(r)
    );
  }, [assignments]);

  /* ---------------- actions ---------------- */

  async function createAssignment() {
    if (selectedCandidateIds.length === 0) return;

    // pick a single topic (first selected; otherwise most-populated)
    const topic = config.topics[0] ?? topics[0] ?? "";
    if (!topic) return;

    const payload = {
      candidateIds: selectedCandidateIds.map(String),
      questionIds: [], // questions are fetched by candidate flow later
      config: {
        topic,
        count: config.questionCount,
        // optionally: time limit/types if BE uses them
      },
      schedule,
    };

    try {
      const res = await createAssignmentSvc(payload as any);
      const sessionId = (res as any)?.sessionId ?? (res as any)?.id;
      if (sessionId) navigate(`/app/sessions/${sessionId}`);

      // refresh list to show newly created
      const fresh = await getAssignmentsSvc();
      setAssignments(normalizeList(fresh));

      // reset wizard
      setSelectedCandidateIds([]);
      setStep(1);
    } catch (e: any) {
      const sid = e?.sessionId ?? e?.data?.sessionId;
      if (sid) {
        navigate(`/app/sessions/${sid}`);
        return;
      }
      console.error("Failed to create session", e);
      alert(e?.error || e?.message || "Failed to create session");
    }
  }

  async function removeAssignment(id: string) {
    try {
      await deleteAssignmentSvc(id);
      const fresh = await getAssignmentsSvc();
      setAssignments(normalizeList(fresh));
    } catch (e) {
      console.error("Failed to delete", e);
    }
  }

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0f2744]/10 px-3 py-1 text-xs font-medium text-[#0f2744]">
              Recruiter
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[#0f2744]">
              Assignments
            </h1>
            <p className="text-sm text-gray-600">
              Create and schedule configured exams for candidates.
            </p>
          </div>
          <div className="text-xs text-gray-600">
            {openAssignments.length} open assignments
          </div>
        </div>
      </div>

      {/* Builder */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {/* Stepper */}
        <div className="mb-6 grid grid-cols-3 gap-2">
          {[
            { n: 1, label: "Candidates" },
            { n: 2, label: "Configuration" },
            { n: 3, label: "Schedule & Review" },
          ].map((s) => (
            <button
              key={s.n}
              onClick={() => setStep(s.n as any)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                step === s.n
                  ? "border-[#ff7a59] bg-[#ff7a59]/10 text-[#0f2744]"
                  : "border-gray-200 text-gray-700 hover:bg-[#0f2744]/5"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  step === s.n
                    ? "bg-[#ff7a59] text-white"
                    : "bg-gray-200 text-gray-700"
                }`}
              >
                {s.n}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Step 1: Candidates */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-700">
                  Candidates
                </div>
                <input
                  value={candidateQuery}
                  onChange={(e) => setCandidateQuery(e.target.value)}
                  placeholder="Search candidates"
                  className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {candidates
                  .filter((c) =>
                    candidateQuery
                      ? `${c.name} ${c.email}`
                          .toLowerCase()
                          .includes(candidateQuery.toLowerCase())
                      : true
                  )
                  .map((c) => {
                    const active = selectedCandidateIds.includes(String(c.id));
                    return (
                      <button
                        key={String(c.id)}
                        onClick={() =>
                          setSelectedCandidateIds((list) =>
                            active
                              ? list.filter((id) => id !== String(c.id))
                              : [...list, String(c.id)]
                          )
                        }
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                          active
                            ? "border-[#ff7a59]/40 bg-[#ff7a59]/10 text-[#0f2744]"
                            : "border-[#0f2744]/20 text-[#0f2744] hover:bg-[#0f2744]/5"
                        }`}
                      >
                        <span>{c.name}</span>
                        <span className="rounded-full bg-[#0f2744]/10 px-2 py-0.5 text-[10px] text-[#0f2744]">
                          {c.email}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                disabled={selectedCandidateIds.length === 0}
                onClick={() => setStep(2)}
                className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Configuration (no Advanced section; Types & Time limit are here) */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Topics */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-700">Topics</div>
                <div className="flex items-center gap-2">
                  <input
                    value={topicQuery}
                    onChange={(e) => setTopicQuery(e.target.value)}
                    placeholder="Search topics"
                    className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                  />
                  <button
                    onClick={() =>
                      setConfig((cfg) => ({ ...cfg, topics: topics.slice() }))
                    }
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setConfig((cfg) => ({ ...cfg, topics: [] }))}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {topics
                  .filter((s) =>
                    topicQuery
                      ? s.toLowerCase().includes(topicQuery.toLowerCase())
                      : true
                  )
                  .sort(
                    (a, b) =>
                      (topicCountsByFilter[b] || 0) -
                      (topicCountsByFilter[a] || 0)
                  )
                  .map((s) => {
                    const active = config.topics.includes(s);
                    const count = topicCountsByFilter[s] || 0;
                    return (
                      <button
                        key={s}
                        onClick={() =>
                          setConfig((cfg) => ({
                            ...cfg,
                            topics: active
                              ? cfg.topics.filter((x) => x !== s)
                              : [...cfg.topics, s],
                          }))
                        }
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                          active
                            ? "border-[#ff7a59]/40 bg-[#ff7a59]/10 text-[#0f2744]"
                            : "border-[#0f2744]/20 text-[#0f2744] hover:bg-[#0f2744]/5"
                        }`}
                      >
                        <span>{s}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            active
                              ? "bg-[#ff7a59]/20 text-[#0f2744]"
                              : "bg-[#0f2744]/10 text-[#0f2744]"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                <span>Available questions with current selection</span>
                <span
                  className={
                    poolSize === 0 ? "text-rose-600" : "text-[#0f2744]"
                  }
                >
                  {poolSize}
                </span>
              </div>
            </div>

            {/* Core config row */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Question count
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(config.questionCount)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    const n = Math.max(1, Math.min(50, Number(digits) || 1));
                    setConfig((cfg) => ({ ...cfg, questionCount: n }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  className="accent-gray-600"
                  type="checkbox"
                  checked={config.adaptive}
                  onChange={(e) =>
                    setConfig((cfg) => ({ ...cfg, adaptive: e.target.checked }))
                  }
                />
                Adaptive mode
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  className="accent-gray-600"
                  type="checkbox"
                  checked={config.randomizeOrder}
                  onChange={(e) =>
                    setConfig((cfg) => ({
                      ...cfg,
                      randomizeOrder: e.target.checked,
                    }))
                  }
                />
                Randomize order
              </label>
            </div>

            {/* Types + Time limit (moved out of Advanced) */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-[#0f2744]">
                  Types
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["MCQ"] as const).map((t) => {
                    const active = config.allowedTypes.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() =>
                          setConfig((cfg) => ({
                            ...cfg,
                            allowedTypes: active
                              ? cfg.allowedTypes.filter((x) => x !== t)
                              : [...cfg.allowedTypes, t],
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${
                          active
                            ? "border-[#0f2744]/40 bg-[#0f2744]/10 text-[#0f2744]"
                            : "border-[#0f2744]/20 text-[#0f2744] hover:bg-[#0f2744]/5"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0f2744]">
                  Time limit (minutes)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(config.timeLimitMinutes ?? 0)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    const n = Math.max(0, Math.min(240, Number(digits) || 0));
                    setConfig((cfg) => ({ ...cfg, timeLimitMinutes: n }));
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 rounded-xl border border-[#0f2744]/30 bg-white px-4 py-2 text-sm font-medium text-[#0f2744] shadow-sm hover:bg-[#0f2744]/10"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Schedule & Review */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Start (optional)
                </label>
                <input
                  type="datetime-local"
                  value={formatDateTimeLocal(schedule.startAt)}
                  onChange={(e) =>
                    setSchedule((s) => ({
                      ...s,
                      startAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Due (optional)
                </label>
                <input
                  type="datetime-local"
                  value={formatDateTimeLocal(schedule.dueAt)}
                  onChange={(e) =>
                    setSchedule((s) => ({
                      ...s,
                      dueAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm font-medium text-[#0f2744]">Review</div>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                <li>• Candidates: {selectedCandidateIds.length}</li>
                <li>• Topics: {config.topics.length || "All"}</li>
                <li>
                  • Count: {config.questionCount}, Adaptive:{" "}
                  {config.adaptive ? "Yes" : "No"}, Randomize:{" "}
                  {config.randomizeOrder ? "Yes" : "No"}
                </li>
                <li>• Types: {config.allowedTypes.join(", ")}</li>
                <li>
                  • Time limit:{" "}
                  {config.timeLimitMinutes
                    ? `${config.timeLimitMinutes}m`
                    : "—"}
                </li>
                <li>
                  • Window:{" "}
                  {schedule.startAt
                    ? new Date(schedule.startAt).toLocaleString()
                    : "—"}{" "}
                  →{" "}
                  {schedule.dueAt
                    ? new Date(schedule.dueAt).toLocaleString()
                    : "—"}
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1 rounded-xl border border-[#0f2744]/30 bg-white px-4 py-2 text-sm font-medium text-[#0f2744] shadow-sm hover:bg-[#0f2744]/10"
              >
                Back
              </button>
              <button
                onClick={createAssignment}
                disabled={selectedCandidateIds.length === 0}
                className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
              >
                Create assignment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing assignments (only open/unfinished) */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-[#0f2744]">Existing assignments</h3>
          <div className="text-xs text-gray-600">
            {openAssignments.length} open
          </div>
        </div>

        {viewMode === "simple" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {openAssignments.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
                No assignments yet
              </div>
            )}
            {openAssignments.map((a: AnyRow) => {
              const id = toSessionId(a)!;
              const createdAt =
                a.created_at ??
                a.createdAt ??
                a.session?.created_at ??
                a.started_at ??
                null;
              const candidate =
                a.candidate_name ??
                a.candidate ??
                a.user_name ??
                a.user?.name ??
                "";
              return (
                <div key={id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-[#0f2744]">
                      Session #{id}
                    </div>
                    <div className="text-xs text-gray-500">
                      {createdAt ? new Date(createdAt).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    Candidate:{" "}
                    <span className="font-medium">{candidate || "—"}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Link
                      to={`/app/sessions/${toSessionId(a)!}`}
                      className="inline-flex items-center gap-1 rounded-md bg-[#ff7a59] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Open
                    </Link>
                    <button
                      onClick={() => removeAssignment(id)}
                      className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-600">
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {openAssignments.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      No assignments yet
                    </td>
                  </tr>
                )}
                {openAssignments.map((a: AnyRow, i: number) => {
                  const id = toSessionId(a)!;
                  const createdAt =
                    a.created_at ??
                    a.createdAt ??
                    a.session?.created_at ??
                    a.started_at ??
                    null;
                  const candidate =
                    a.candidate_name ??
                    a.candidate ??
                    a.user_name ??
                    a.user?.name ??
                    "";
                  return (
                    <tr key={id} className={i % 2 ? "bg-white" : "bg-white"}>
                      <td className="px-3 py-2">#{id}</td>
                      <td className="px-3 py-2">{candidate || "—"}</td>
                      <td className="px-3 py-2">
                        {createdAt ? new Date(createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Link
                            to={`/app/sessions/${toSessionId(a)!}`}
                            className="inline-flex items-center gap-1 rounded-md bg-[#ff7a59] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Open
                          </Link>
                          <button
                            onClick={() => removeAssignment(id)}
                            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
