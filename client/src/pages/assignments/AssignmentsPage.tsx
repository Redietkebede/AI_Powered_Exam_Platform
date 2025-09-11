import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getUsers } from "../../services/userService";
import { getQuestions } from "../../services/questionService";
import type { Question } from "../../types/question";
import { Trash2, Copy, Play } from "lucide-react";
import {
  createAssignmentSvc,
  getAssignmentsSvc,
} from "../../services/assignmentService";

/* ------------ Types (local, no API changes) ------------ */

type DifficultyLabel = Question["difficulty"];
type QType = Question["type"];

type ExamConfig = {
  topics: string[];
  allowedDifficulties: DifficultyLabel[];
  allowedTypes: QType[];
  questionCount: number;
  adaptive: boolean;
  randomizeOrder: boolean;
  timeLimitMinutes?: number;
};

// Map 1..5 -> labels; pass strings through
// 1..5 -> labels; pass labels through; default Medium
function toDiffLabel(d: unknown) {
  if (typeof d === "number" && Number.isFinite(d)) {
    const map = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"] as const;
    const i = Math.min(5, Math.max(1, Math.floor(d))) - 1;
    return map[i];
  }
  const s = String(d ?? "").trim();
  return (["Very Easy","Easy","Medium","Hard","Very Hard"] as const).includes(s as any)
    ? (s as any)
    : "Medium";
}

function toTypeLabel(t: unknown) {
  const s = String(t ?? "").trim().toUpperCase();
  if (s === "MCQ") return "MCQ";
  if (s === "SHORT ANSWER") return "Short Answer";
  if (s === "ESSAY") return "Essay";
  return "MCQ";
}

// accept published OR approved
function isAssignableStatus(s: unknown) {
  const v = String(s ?? "").toLowerCase();
  return v === "published" || v === "approved";
}

// prefer DB `topic`, fallback to legacy `subject`
function getTopic(q: any) {
  return (q?.topic ?? q?.subject ?? "").trim() || "Uncategorized";
}

type ScheduleWindow = { startAt?: string; dueAt?: string };

type Assignment = {
  id: string;
  candidateIds: string[];
  questionIds: number[];
  config: ExamConfig;
  schedule: ScheduleWindow;
  status: "scheduled" | "active" | "expired";
  createdAt: string;
  createdBy?: string;
};

type UserRole = "admin" | "editor" | "recruiter" | "candidate";
type User = {
  id: number | string;
  name: string;
  email: string;
  role: UserRole;
};
type Candidate = User & { role: "candidate" };
type Recruiter = User & { role: "recruiter" };

const isCandidate = (u: User): u is Candidate => u.role === "candidate";
const isRecruiter = (u: User): u is Recruiter => u.role === "recruiter";

/* ------------ Utilities ------------ */

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

function computeStatus(
  sched: ScheduleWindow,
  now = new Date()
): Assignment["status"] {
  const start = sched.startAt ? new Date(sched.startAt) : undefined;
  const due = sched.dueAt ? new Date(sched.dueAt) : undefined;
  if (start && now < start) return "scheduled";
  if (due && now > due) return "expired";
  return "active";
}

function normalizeTopic(s?: string | null): string {
  const v = (s ?? "").trim();
  return v ? v : "Uncategorized";
}

/* ------------ Component ------------ */

export default function AssignmentsPage() {
  // UI state
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
    []
  );
  const [candidateQuery, setCandidateQuery] = useState("");
  const [topicQuery, setTopicQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [list, setList] = useState<Assignment[]>([]);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable"
  );
  const [viewMode, setViewMode] = useState<"detailed" | "simple">("simple");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [users, setUsers] = useState<User[]>([]);
  const [recruiters, setRecruiters] = useState<User[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);

  // Live questions
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
  if (questions.length) {
    console.log("sample question", questions[0]);
  }
}, [questions]);


  // Users
  useEffect(() => {
    let alive = true;
    getUsers()
      .then((list) => {
        if (!alive) return;
        const u = list as User[];
        setUsers(u);
        setRecruiters(u.filter(isRecruiter));
        setCandidates(u.filter(isCandidate));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Questions
  useEffect(() => {
    let alive = true;
    getQuestions({ topic: "" })
      .then((qs) => {
        if (!alive) return;
        setQuestions(qs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Assignments (from backend)
  useEffect(() => {
    let alive = true;
    getAssignmentsSvc()
      .then((items) => {
        if (!alive) return;
        setList(Array.isArray(items) ? items : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Only approved questions for assignment pool
  const allApprovedQuestions = useMemo(
   () => questions.filter((q) => isAssignableStatus(q.status)),
   [questions]
 );

  // Config state
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

  // Topics from live questions (switch from subject -> topic)
  const subjects = useMemo<string[]>(
    () =>
      Array.from(
        new Set(
          allApprovedQuestions.map((q) =>
            normalizeTopic(getTopic(q))
          )
        )
      ).sort((a, b) => a.localeCompare(b)),
    [allApprovedQuestions]
  );

  // Counts per topic given current difficulty/type filters
  const subjectCountsByFilter = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of allApprovedQuestions) {
      if (
        !config.allowedDifficulties.includes(
          toDiffLabel(q.difficulty) as DifficultyLabel
        )
      )
        continue;
      if (!config.allowedTypes.includes(toTypeLabel(q.type) as any)) continue;
      const key = normalizeTopic((q as any).topic as string);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [allApprovedQuestions, config.allowedDifficulties, config.allowedTypes]);

  // Preview pool size (topics + filters)
  const poolSize = useMemo(() => {
   return allApprovedQuestions.filter((q) => {
     const key = normalizeTopic(getTopic(q));
     const okTopic = config.topics.length === 0 || config.topics.includes(key);
     const okDiff = config.allowedDifficulties.includes(toDiffLabel((q as any).difficulty));
     const okType = config.allowedTypes.includes(toTypeLabel((q as any).type) as any);
     return okTopic && okDiff && okType;
   }).length;
 }, [allApprovedQuestions, config.topics, config.allowedDifficulties, config.allowedTypes]);

  // Sampling helper
  function pickQuestions(): number[] {
    const pool = allApprovedQuestions.filter((q) => {
   const key = normalizeTopic(getTopic(q));
   const okTopic = config.topics.length === 0 || config.topics.includes(key);
   const okDiff = config.allowedDifficulties.includes(toDiffLabel((q as any).difficulty));
   const okType = config.allowedTypes.includes(toTypeLabel((q as any).type) as any);
   return okTopic && okDiff && okType;
    });
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled
      .slice(0, Math.max(0, config.questionCount))
      .map((q) => q.id as number);
  }

  async function createAssignment() {
    if (selectedCandidateIds.length === 0) return;
    const questionIds = pickQuestions();
    if (questionIds.length === 0) return;

    const payload = {
      candidateIds: selectedCandidateIds.map(String),
      questionIds,
      config,
      schedule,
    };

    // IMPORTANT: call the API service (was recursively calling itself)
    await createAssignmentSvc(payload);

    // Refresh assignments from server
    try {
      const fresh = await getAssignmentsSvc();
      setList(Array.isArray(fresh) ? fresh : []);
    } catch {
      // ignore
    }

    setSelectedCandidateIds([]);
    setStep(1);
  }

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
            {list.length} total assignments
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

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">
                Select candidates
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={candidateQuery}
                  onChange={(e) => setCandidateQuery(e.target.value)}
                  placeholder="Search by name or email"
                  className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                />
                <button
                  onClick={() =>
                    setSelectedCandidateIds(candidates.map((c) => String(c.id)))
                  }
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedCandidateIds([])}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 p-3">
              {candidates
                .filter((c) =>
                  candidateQuery
                    ? (c.name + " " + c.email)
                        .toLowerCase()
                        .includes(candidateQuery.toLowerCase())
                    : true
                )
                .map((c) => {
                  const id = String(c.id);
                  const checked = selectedCandidateIds.includes(id);
                  return (
                    <label
                      key={id}
                      className={`group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[#0f2744]/5 ${
                        checked
                          ? "bg-[#ff7a59]/10 border border-[#ff7a59]/30"
                          : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          className="accent-gray-600"
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedCandidateIds((prev) =>
                              prev.includes(id)
                                ? prev.filter((x) => x !== id)
                                : [...prev, id]
                            )
                          }
                        />
                        <span className="text-gray-800">{c.name}</span>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          checked
                            ? "bg-[#ff7a59]/20 text-[#0f2744]"
                            : "bg-[#0f2744]/10 text-[#0f2744]"
                        }`}
                      >
                        {c.email}
                      </span>
                    </label>
                  );
                })}
              {candidates.length === 0 && (
                <div className="text-sm text-gray-500">No candidates</div>
              )}
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

        {step === 2 && (
          <div className="space-y-6">
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
                      setConfig((cfg) => ({ ...cfg, topics: subjects.slice() }))
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
                {subjects
                  .filter((s) =>
                    topicQuery
                      ? s.toLowerCase().includes(topicQuery.toLowerCase())
                      : true
                  )
                  .sort(
                    (a, b) =>
                      (subjectCountsByFilter[b] || 0) -
                      (subjectCountsByFilter[a] || 0)
                  )
                  .map((s) => {
                    const active = config.topics.includes(s);
                    const count = subjectCountsByFilter[s] || 0;
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
                  className={`${
                    poolSize === 0 ? "text-rose-600" : "text-[#0f2744]"
                  }`}
                >
                  {poolSize}
                </span>
              </div>
            </div>

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
                    const n = Math.max(0, Math.min(50, Number(digits) || 0));
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

            {false && config.questionCount > poolSize && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Requested count exceeds available pool ({poolSize}). The exam
                will use all available questions.
              </div>
            )}

            <div className="rounded-lg border border-gray-200">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm"
              >
                <span className="font-medium text-[#0f2744]">
                  Advanced options
                </span>
                <span className="text-[#0f2744]">
                  {showAdvanced ? "Hide" : "Show"}
                </span>
              </button>

              {showAdvanced && (
                <div className="grid gap-4 border-t border-gray-200 p-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm font-medium text-[#0f2744]">
                      Difficulties
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          "Very Easy",
                          "Easy",
                          "Medium",
                          "Hard",
                          "Very Hard",
                        ] as const
                      ).map((d) => {
                        const active = config.allowedDifficulties.includes(d);
                        return (
                          <button
                            key={d}
                            onClick={() =>
                              setConfig((cfg) => ({
                                ...cfg,
                                allowedDifficulties: active
                                  ? cfg.allowedDifficulties.filter(
                                      (x) => x !== d
                                    )
                                  : [...cfg.allowedDifficulties, d],
                              }))
                            }
                            className={`rounded-full border px-3 py-1 text-xs ${
                              active
                                ? "border-[#0f2744]/40 bg-[#0f2744]/10 text-[#0f2744]"
                                : "border-[#0f2744]/20 text-[#0f2744] hover:bg-[#0f2744]/5"
                            }`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>

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
                        const n = Math.max(
                          0,
                          Math.min(240, Number(digits) || 0)
                        );
                        setConfig((cfg) => ({ ...cfg, timeLimitMinutes: n }));
                      }}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f2744]/40 focus:border-[#0f2744]"
                    />
                  </div>
                </div>
              )}
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

            {/* Review */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-sm font-medium text-[#0f2744]">Review</div>
              <ul className="mt-2 text-sm text-gray-700 space-y-1">
                <li>• Candidates: {selectedCandidateIds.length}</li>
                <li>• Topics: {config.topics.length || "All"}</li>
                <li>
                  • Count: {config.questionCount}, Adaptive:{" "}
                  {config.adaptive ? "Yes" : "No"}, Randomize:{" "}
                  {config.randomizeOrder ? "Yes" : "No"}
                </li>
                <li>• Difficulties: {config.allowedDifficulties.join(", ")}</li>
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
                className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
                disabled={selectedCandidateIds.length === 0}
              >
                Create assignment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing assignments */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-[#0f2744]">Existing assignments</h3>
          <div className="text-xs text-gray-600">{list.length} total</div>
        </div>

        {viewMode === "simple" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
                No assignments yet
              </div>
            )}
            {list
              .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
              .map((a) => {
                const st = computeStatus(a.schedule);
                const window = [
                  a.schedule.startAt
                    ? new Date(a.schedule.startAt).toLocaleDateString()
                    : "—",
                  a.schedule.dueAt
                    ? new Date(a.schedule.dueAt).toLocaleDateString()
                    : "—",
                ].join(" → ");
                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-600">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          st === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : st === "scheduled"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {st}
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-gray-700 space-y-1">
                      <div>
                        Candidates:{" "}
                        <span className="font-medium text-slate-900">
                          {a.candidateIds.length}
                        </span>{" "}
                        • Questions:{" "}
                        <span className="font-medium text-slate-900">
                          {a.questionIds.length}
                        </span>
                      </div>
                      <div title={window}>
                        Window:{" "}
                        <span className="font-medium text-slate-900">
                          {window}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Link
                        to={`/app/exam?assignmentId=${a.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-[#ff7a59] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                      >
                        <Play className="h-3.5 w-3.5" /> Test
                      </Link>
                      <button
                        onClick={() => {
                          const copy: Assignment = {
                            ...a,
                            id: crypto.randomUUID(),
                            createdAt: new Date().toISOString(),
                          };
                          const updated = [copy, ...list];
                          setList(updated);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md"
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </button>
                      <button
                        onClick={() => {
                          const updated = list.filter((x) => x.id !== a.id);
                          setList(updated);
                          // if you add a BE delete: await deleteAssignmentSvc(a.id)
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-700">
                  <th className="px-3 py-2 font-medium">Candidates</th>
                  <th className="px-3 py-2 font-medium">Topics</th>
                  <th className="px-3 py-2 font-medium">Questions</th>
                  <th className="px-3 py-2 font-medium">Adaptive</th>
                  <th className="px-3 py-2 font-medium">Time limit</th>
                  <th className="px-3 py-2 font-medium">Window</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      No assignments yet
                    </td>
                  </tr>
                )}
                {list
                  .slice(
                    (page - 1) * pageSize,
                    (page - 1) * pageSize + pageSize
                  )
                  .map((a, idx) => {
                    const st = computeStatus(a.schedule);
                    const window = [
                      a.schedule.startAt
                        ? new Date(a.schedule.startAt).toLocaleString()
                        : "—",
                      a.schedule.dueAt
                        ? new Date(a.schedule.dueAt).toLocaleString()
                        : "—",
                    ].join(" → ");
                    const zebra = idx % 2 === 0 ? "bg-white" : "bg-neutral-50";
                    const pad = density === "compact" ? "py-1.5" : "py-2";
                    return (
                      <tr
                        key={a.id}
                        className={`${zebra} hover:bg-[#0f2744]/5`}
                      >
                        <td className={`px-3 ${pad} text-right`}>
                          {a.candidateIds.length}
                        </td>
                        <td className={`px-3 ${pad} text-right`}>
                          {a.config.topics.length || "All"}
                        </td>
                        <td className={`px-3 ${pad} text-right`}>
                          {a.questionIds.length}
                        </td>
                        <td className={`px-3 ${pad}`}>
                          {a.config.adaptive ? "Yes" : "No"}
                        </td>
                        <td className={`px-3 ${pad} text-right`}>
                          {a.config.timeLimitMinutes
                            ? `${a.config.timeLimitMinutes}m`
                            : "—"}
                        </td>
                        <td className={`px-3 ${pad}`} title={window}>
                          <div className="max-w-[220px] truncate">{window}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              st === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : st === "scheduled"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {st}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/app/exam?assignmentId=${a.id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-[#ff7a59] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 cursor-pointer"
                            >
                              <Play className="h-3.5 w-3.5" /> Test
                            </Link>
                            <button
                              onClick={() => {
                                const copy: Assignment = {
                                  ...a,
                                  id: crypto.randomUUID(),
                                  createdAt: new Date().toISOString(),
                                };
                                const updated = [copy, ...list];
                                setList(updated);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[#0f2744]/20 px-3 py-1.5 text-xs text-[#0f2744] hover:bg-[#0f2744]/5 cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" /> Duplicate
                            </button>
                            <button
                              onClick={() => {
                                const updated = list.filter(
                                  (x) => x.id !== a.id
                                );
                                setList(updated);
                                // if you add a BE delete: await deleteAssignmentSvc(a.id)
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
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
        {/* Pagination */}
        {list.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
            <div>
              Showing {Math.min((page - 1) * pageSize + 1, list.length)}–
              {Math.min(page * pageSize, list.length)} of {list.length}
            </div>
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-3 py-1 ${
                  page === 1
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-[#0f2744]/5"
                }`}
              >
                Prev
              </button>
              <div className="px-3 py-1 border-l border-r border-gray-200">
                Page {page}
              </div>
              <button
                onClick={() =>
                  setPage((p) => (p * pageSize < list.length ? p + 1 : p))
                }
                disabled={page * pageSize >= list.length}
                className={`px-3 py-1 ${
                  page * pageSize >= list.length
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-[#0f2744]/5"
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
