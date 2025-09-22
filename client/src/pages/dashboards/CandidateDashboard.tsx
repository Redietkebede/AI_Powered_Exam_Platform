import { Link, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect, useRef } from "react";

import { getCurrentUser } from "../../services/authService";
import { type User } from "../../services/userService";

import {
  startAttempt,
  getAttempts,
  getAssignmentCompletions,
  type AttemptRecord,
  type AssignmentCompletion,
} from "../../services/examService";

import {
  getMyAssignmentsSvc,
  type DbSessionRow,
} from "../../services/assignmentService";

import { getSessionTopic } from "../../services/sessions";

/** ------------------------------
 * Types used in the dashboard
 * ------------------------------ */
type AssignedExam = {
  id: string; // UI key (NOT a session id)
  sessionId?: number | null; // real session id if known (usually null here)
  testId: number;
  title: string;
  description: string;
  dueDate: string;
  duration: number;
  questionCount: number;
  status: string;
  topics: string[];
  guidelines: string[];
  isCompleted: boolean;
  completionData: { score: number } | null;
};

// ---------- helpers to read fields from mixed shapes ----------
const bool = (v: any) => Boolean(v);

function getAttemptMeta(a: AttemptRecord) {
  const finished = bool(
    (a as any).completedAt ?? (a as any).finishedAt ?? (a as any).finished_at
  );
  const testIdRaw =
    (a as any).testId ?? (a as any).test_id ?? (a as any).test?.id;
  const testId = Number(testIdRaw);
  return { finished, testId: Number.isFinite(testId) ? testId : NaN };
}

function getCompletionTestId(c: AssignmentCompletion) {
  const raw =
    (c as any).testId ?? (c as any).test_id ?? (c as any).assignmentId;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export default function CandidateDashboard() {
  const navigate = useNavigate();

  const [showGuidelinesModal, setShowGuidelinesModal] = useState<string | null>(
    null
  );
  const [user, setUser] = useState<User | null>(null);

  // kept for compatibility if other parts of UI read them
  const [_sessions, _setSessions] = useState<DbSessionRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [completions, setCompletions] = useState<AssignmentCompletion[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState<boolean>(false);

  // Raw rows returned from GET /api/assignments/mine (or similar)
  const [serverAssignments, setServerAssignments] = useState<any[]>([]);

  // Map: sessionId(string) -> topic (first question’s topic); we only fill this when we truly have a session id
  const [topicBySession, setTopicBySession] = useState<
    Record<string, string | null>
  >({});

  /** ------------------------------
   * Data fetching
   * ------------------------------ */
  useEffect(() => {
    (async () => {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingAssignments(true);
        const rows = await getMyAssignmentsSvc();
        if (!alive) return;

        const list = Array.isArray(rows)
          ? rows
          : rows &&
            typeof rows === "object" &&
            "items" in rows &&
            Array.isArray((rows as any).items)
          ? (rows as any).items
          : [];

        setServerAssignments(list);

        // ⚠️ Do NOT attempt getSessionTopic() here: these are assignment rows,
        // not real sessions yet. We leave topicBySession empty for now.
        setTopicBySession({});
      } catch {
        if (!alive) return;
        setServerAssignments([]);
      } finally {
        setLoadingAssignments(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await getAttempts();
        if (!alive) return;
        setAttempts(Array.isArray(rows) ? rows : []);
      } catch {
        if (!alive) return;
        setAttempts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getAssignmentCompletions();
        if (!alive) return;
        setCompletions(Array.isArray(list) ? list : []);
      } catch {
        if (!alive) return;
        setCompletions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    console.table(
      serverAssignments?.map((r) => ({
        id: r.id ?? r.session_id ?? r.sessionId,
        test_id: r.test_id ?? r.testId,
        topic_pick:
          r?.test?.topic ?? r.topic_name ?? r.test_topic ?? r.topic ?? "—",
        total_questions: r.total_questions ?? r.totalQuestions,
        finished_at: r.finished_at ?? r.finishedAt,
      }))
    );
  }, [serverAssignments]);

  useEffect(() => {
    console.debug("topicBySession", topicBySession);
  }, [topicBySession]);

  /** ------------------------------
   * Derivations
   * ------------------------------ */

  // which testIds this user already completed
  const completedTestIds = useMemo(() => {
    const name = user?.name ?? "";

    const fromAttempts = (attempts ?? [])
      .filter((a) => a.candidate === name)
      .map((a) => getAttemptMeta(a))
      .filter((m) => m.finished && Number.isFinite(m.testId))
      .map((m) => m.testId);

    const fromCompletions = (completions ?? [])
      .filter((c) => c.candidate === name)
      .map((c) => getCompletionTestId(c))
      .filter((n) => Number.isFinite(n));

    return new Set([...fromAttempts, ...fromCompletions]);
  }, [attempts, completions, user?.name]);

  const candidateAttempts = useMemo(() => {
    const name = user?.name ?? "";
    return attempts.filter((a) => a.candidate === name);
  }, [attempts, user?.name]);

  const stats = useMemo(() => {
    const name = user?.name ?? "";

    const assignmentCompletions = completions.filter(
      (c) => c.candidate === name
    );

    type Row = {
      score: number;
      questions: number;
      correct: number;
      isAssignment: boolean;
    };

    const attemptRows: Row[] = candidateAttempts.map((attempt) => ({
      score:
        attempt.items.length > 0
          ? Math.round(
              (attempt.items.filter((i) => i.correct).length /
                attempt.items.length) *
                100
            )
          : 0,
      questions: attempt.items.length,
      correct: attempt.items.filter((i) => i.correct).length,
      isAssignment: false,
    }));

    const completionRows: Row[] = assignmentCompletions.map((completion) => ({
      score: completion.score ?? 0,
      questions: 0,
      correct: 0,
      isAssignment: true,
    }));

    const allCompletions: Row[] = [...attemptRows, ...completionRows];

    const totalAttempts = allCompletions.length;
    const avgScore =
      totalAttempts > 0
        ? Math.round(
            allCompletions.reduce((sum, c) => sum + (c.score || 0), 0) /
              totalAttempts
          )
        : 0;

    const attemptCompletions = allCompletions.filter((c) => !c.isAssignment);
    const totalQuestions = attemptCompletions.reduce(
      (sum, c) => sum + (c.questions || 0),
      0
    );
    const correctAnswers = attemptCompletions.reduce(
      (sum, c) => sum + (c.correct || 0),
      0
    );
    const accuracy =
      totalQuestions > 0
        ? Math.round((correctAnswers / totalQuestions) * 100)
        : 0;

    return {
      totalAttempts,
      avgScore,
      totalQuestions,
      correctAnswers,
      accuracy,
    };
  }, [candidateAttempts, completions, user?.name]);

  const recentAttempts = useMemo(() => {
    const name = user?.name ?? "";
    const assignmentCompletions = completions.filter(
      (c) => c.candidate === name
    );

    type Row = {
      type: "attempt" | "assignment";
      id: string;
      date: string;
      score: number;
      questions: number;
      correct: number;
    };

    const attemptRows: Row[] = candidateAttempts.map((attempt) => ({
      type: "attempt",
      id: attempt.attemptId,
      date: attempt.startedAt,
      score:
        attempt.items.length > 0
          ? Math.round(
              (attempt.items.filter((i) => i.correct).length /
                attempt.items.length) *
                100
            )
          : 0,
      questions: attempt.items.length,
      correct: attempt.items.filter((i) => i.correct).length,
    }));

    const completionRows: Row[] = assignmentCompletions.map((completion) => ({
      type: "assignment",
      id: String(completion.assignmentId),
      date: completion.completedAt,
      score: completion.score ?? 0,
      questions: 0,
      correct: 0,
    }));

    return [...attemptRows, ...completionRows]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6);
  }, [candidateAttempts, completions, user?.name]);

  // Build cards list; hide tests already completed by this user
  const assignedExams: AssignedExam[] = useMemo(() => {
    if (!serverAssignments?.length) return [];

    return serverAssignments
      .map((r) => {
        const testIdNum =
          Number(
            r.test_id ?? r.testId ?? r.assignment_id ?? r.assignmentId ?? NaN
          ) || 0;

        const isFinishedRow = Boolean(r.finished_at || r.finishedAt);
        const isCompletedByUser =
          Number.isFinite(testIdNum) && completedTestIds.has(testIdNum);
        if (isFinishedRow || isCompletedByUser) return null; // hide it

        // ⚠️ Do NOT treat assignment id as a session id.
        const uiId = String(
          r.id ??
            r.assignment_id ??
            r.assignmentId ??
            r.test_id ??
            r.testId ??
            Math.random()
        );

        // Prefer test.topic → other fallbacks; do not query session topic yet
        const resolvedTopic =
          (r?.test?.topic && r.test.topic !== "General"
            ? r.test.topic
            : null) ??
          (r.test_topic && r.test_topic !== "General" ? r.test_topic : null) ??
          (r.topic && r.topic !== "General" ? r.topic : null) ??
          "—";

        const count = Number(r.total_questions ?? r.totalQuestions ?? 0) || 10;
        const totalMinutes = count; // UI: 1 min per question

        // topics: don’t surface unusable placeholders
        const topics =
          !resolvedTopic ||
          resolvedTopic === "-" ||
          resolvedTopic === "—" ||
          resolvedTopic.toLowerCase() === "general"
            ? []
            : [resolvedTopic];

        return {
          id: uiId,
          sessionId: Number(r.session_id ?? r.id ?? null),
          testId: testIdNum,
          title: `${resolvedTopic} Assessment`,
          description: resolvedTopic,
          dueDate: r.started_at ?? r.startedAt ?? "",
          duration: totalMinutes,
          questionCount: count,
          status: "pending",
          topics,
          guidelines: [
            `You have ${totalMinutes} minutes to complete the exam`,
            "Questions are presented in a fixed order",
            `Covered topics: ${resolvedTopic}`,
            "Question types: multiple choice",
            "Ensure a stable internet connection and avoid refreshing the page",
            "⚠️ IMPORTANT: Only ONE attempt is allowed per exam.",
          ],
          isCompleted: false,
          completionData: null,
        } as AssignedExam;
      })
      .filter(Boolean) as AssignedExam[];
  }, [serverAssignments, completedTestIds]);

  useEffect(() => {
    (async () => {
      // fetch topics only for cards missing a chip
      const todo = assignedExams
        .filter(
          (e) => e.sessionId && (!e.topics.length || e.description === "—")
        )
        .slice(0, 10); // throttle a bit if needed
      for (const ex of todo) {
        try {
          const dto = await getSessionTopic(ex.sessionId!);
          if (dto?.topic && dto.topic.toLowerCase() !== "general") {
            setTopicBySession((prev) => ({ ...prev, [ex.id]: dto.topic }));
          }
        } catch {
          /* ignore */
        }
      }
    })();
  }, [assignedExams]);

  const completedExams = useMemo(
    () => candidateAttempts.filter((a) => !!a.completedAt),
    [candidateAttempts]
  );

  /** ------------------------------
   * UI helpers & actions
   * ------------------------------ */
  const openGuidelines = async (examId: string) => {
    // Live refresh from first-question topic ONLY if we truly have a session id
    const ex = assignedExams.find((e) => e.id === examId) || null;
    if (
      ex &&
      (!ex.topics.length || ex.description === "—") &&
      Number.isFinite(ex.sessionId) &&
      (ex.sessionId as number) > 0
    ) {
      try {
        const dto = await getSessionTopic(ex.sessionId as number);
        if (dto?.topic && dto.topic.toLowerCase() !== "general") {
          setTopicBySession((prev) => ({ ...prev, [examId]: dto.topic }));
        }
      } catch {
        /* ignore */
      }
    }
    setShowGuidelinesModal(examId);
  };

  const closeGuidelines = () => setShowGuidelinesModal(null);
  const getCurrentExam = () =>
    assignedExams.find((e) => e.id === showGuidelinesModal) || null;

  const startingRef = useRef(false);

  async function handleStartExam(exam: AssignedExam) {
    if (startingRef.current) return; // guard double-click/StrictMode
    startingRef.current = true;

    const goTo = async (sid: number | string) =>
      navigate(`/app/exam?attemptId=${sid}`, { replace: true });

    try {
      // Always start (backend may reuse unfinished if any)
      const testId = Number(exam?.testId);
      if (!Number.isFinite(testId) || testId <= 0) {
        alert("Cannot start: invalid test id.");
        return;
      }

      // Do NOT pass topics — let BE pick questions freely
      const attemptId = await startAttempt({
        testId,
        limit: exam?.questionCount || undefined,
        durationSeconds: exam?.duration
          ? Math.round(exam.duration * 60)
          : undefined,
      });

      if (!attemptId) throw new Error("No attempt id");
      await goTo(attemptId);
    } catch (err) {
      console.error("Failed to start session", err);
      alert("Failed to start session");
    } finally {
      startingRef.current = false;
    }
  }

  /** ------------------------------
   * Render
   * ------------------------------ */
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 bg-gradient-to-br from-slate-50 via-white to-slate-50 min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <div className="flex items-center">
          <div className="w-12 h-12 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-4 hover:scale-105 transition-all duration-300 shadow-md">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 mb-2 sm:mb-3">
              Welcome Back!
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
              Ready for your next assessment? Let's get started with confidence.
            </p>
          </div>
        </div>
      </div>

      {/* Assigned Exams */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
          <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
            <svg
              className="w-6 h-6 text-white"
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
          Your Assigned Exams
        </h2>

        {loadingAssignments ? (
          <div className="text-slate-600">Loading…</div>
        ) : assignedExams.length > 0 ? (
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {assignedExams.map((exam) => (
              <div
                key={exam.id}
                className="bg-gradient-to-br from-white via-slate-100/30 to-slate-200/20 rounded-2xl p-6 border border-slate-300/30 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 hover:border-slate-400/50 group shadow-lg"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-all duration-300 shadow-md bg-gradient-to-br from-[#ff7a59] to-[#ff7a59]">
                    <svg
                      className="w-5 h-5 text-white"
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
                  <span className="text-xs sm:text-sm font-semibold text-[#ff7a59] bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border border-slate-300 shadow-md">
                    {`Due: ${
                      exam.dueDate
                        ? new Date(exam.dueDate).toLocaleDateString()
                        : "—"
                    }`}
                  </span>
                </div>

                <h3 className="font-bold text-slate-800 text-lg sm:text-xl mb-2 sm:mb-3 leading-tight">
                  {exam.title}
                </h3>
                <p className="text-slate-600 text-sm sm:text-base mb-3 sm:mb-4 leading-relaxed">
                  {exam.description}
                </p>

                {/* One topic chip */}
                {/* One topic chip */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {(topicBySession[exam.id] // live fetched
                    ? [topicBySession[exam.id]]
                    : exam.topics
                  ) // static from mapping
                    .filter(Boolean)
                    .map((topic, i) => (
                      <span
                        key={i}
                        className="text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full border shadow-md font-medium bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300"
                      >
                        {topic}
                      </span>
                    ))}
                </div>

                <div className="space-y-3">
                  <button
                    onClick={async () => {
                      await handleStartExam(exam);
                    }}
                    className="inline-flex items-center justify-center w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 py-3 rounded-xl text-sm sm:text-base font-semibold border border-[#ff7a59] shadow-md hover:scale-105 transition-all duration-300"
                  >
                    Start Exam
                    <svg
                      className="w-5 h-5 ml-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>

                  <button
                    onClick={() => openGuidelines(exam.id)}
                    className="inline-flex items-center justify-center w-full bg-slate-100 text-slate-700 px-5 py-3 rounded-xl text-sm sm:text-base font-semibold hover:bg-slate-200 transition-all duration-300 border border-slate-300 shadow-md"
                  >
                    View Guidelines
                    <svg
                      className="w-5 h-5 ml-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg
                className="w-10 h-10 text-slate-600"
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
            <h3 className="text-xl font-semibold text-slate-800 mb-3">
              No assigned exams at the moment
            </h3>
            <p className="text-slate-600 text-base leading-relaxed">
              Your recruiter will assign exams for you to complete. Check back
              soon!
            </p>
          </div>
        )}
      </div>

      {/* Quick Actions & Performance Overview */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Actions */}
        <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl flex items-center justify-center mr-3 shadow-md">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            Quick Actions
          </h2>

          <div className="space-y-3">
            <Link
              to="/app/results"
              className="flex items-center p-4 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-xl border border-slate-300/40 hover:scale-[1.02] transition-all duration-300"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
                <svg
                  className="w-4 h-4 text-white"
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
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-sm sm:text-base mb-1">
                  View My Results
                </h3>
                <p className="text-xs sm:text-sm text-slate-600">
                  Review your performance and see detailed insights.
                </p>
              </div>
              <svg
                className="w-5 h-5 text-slate-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>

            <div className="flex items-center p-4 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-xl border border-slate-300/40">
              <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
                <svg
                  className="w-4 h-4 text-white"
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
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-sm sm:text-base mb-1">
                  Completed Exams
                </h3>
                <p className="text-xs sm:text-sm text-slate-600">
                  Review your completed assessments.
                </p>
              </div>
              <div className="text-right">
                <div className="text-lg sm:text-2xl font-bold text-slate-700">
                  {completedExams.length}
                </div>
                <div className="text-xs sm:text-sm text-slate-700 font-medium">
                  Completed
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Overview */}
        <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2z"
                />
              </svg>
            </div>
            Performance Overview
          </h2>

          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">
                {stats.totalAttempts}
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">
                Total Attempts
              </div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-200/40 to-slate-300/30 rounded-2xl border border-slate-400/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">
                {stats.avgScore}%
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">
                Average Score
              </div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">
                {stats.correctAnswers}/{stats.totalQuestions}
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">
                Correct/Total
              </div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-200/40 to-slate-300/30 rounded-2xl border border-slate-400/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">
                {stats.accuracy}%
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">
                Overall Accuracy
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
          <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
            <svg
              className="w-4 h-4 text-white"
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
          Recent Activity
        </h2>

        {(() => {
          const recent = recentAttempts;
          return recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 sm:p-5 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 hover:border-slate-400/50 shadow-lg"
                >
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 hover:scale-110 transition-transform duration-200 shadow-md">
                      <svg
                        className="w-4 h-4 text-white"
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
                    <div>
                      <div className="font-semibold text-slate-800 text-sm sm:text-lg">
                        {item.type === "assignment"
                          ? "Assignment Completed"
                          : `Exam Attempt #${index + 1}`}
                      </div>
                      <div className="text-slate-600 text-xs sm:text-sm">
                        {new Date(item.date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg sm:text-xl text-[#ff7a59]">
                      {item.score}%
                    </div>
                    <div className="text-xs sm:text-sm text-slate-600">
                      {item.type === "assignment"
                        ? "Assignment"
                        : `${item.questions} questions`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <svg
                  className="w-10 h-10 text-slate-600"
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
              <h3 className="text-xl font-semibold text-slate-800 mb-3">
                No exam attempts yet
              </h3>
              <p className="text-slate-600 text-base leading-relaxed">
                Start your first exam to see your activity here.
              </p>
            </div>
          );
        })()}
      </div>

      {/* Guidelines Modal */}
      {showGuidelinesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-gradient-to-br from-white via-slate-50 to-slate-100 rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-slate-200/50">
            <div className="p-5 sm:p-8">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-2 shadow-md">
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800">
                    Exam Guidelines
                  </h2>
                </div>
                <button
                  onClick={closeGuidelines}
                  className="w-8 h-8 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-800 hover:from-slate-200 hover:to-slate-300 transition-all duration-300 shadow-md hover:scale-110"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {getCurrentExam() && (
                <>
                  <div className="bg-gradient-to-br from-white to-slate-50/50 rounded-xl p-3 sm:p-4 border border-slate-200/50 shadow-lg mb-4 sm:mb-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-1 sm:mb-2">
                          {getCurrentExam()!.title}
                        </h3>
                        <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-2 sm:mb-3">
                          {getCurrentExam()!.description}
                        </p>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {getCurrentExam()!.topics.map((topic, index) => (
                            <span
                              key={index}
                              className="text-[11px] sm:text-xs bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 px-2.5 py-1.5 rounded-full font-medium border border-slate-300 shadow-sm"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="w-8 h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center shadow-md">
                        <svg
                          className="w-4 h-4 text-white"
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
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 p-2.5 sm:p-3 rounded-lg border border-slate-200/50">
                        <div className="flex items-center mb-1">
                          <div className="w-5 h-5 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-lg flex items-center justify-center mr-2 shadow-sm">
                            <svg
                              className="w-3 h-3 text-white"
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
                          <span className="font-semibold text-slate-800 text-xs sm:text-sm">
                            Duration
                          </span>
                        </div>
                        <p className="text-base sm:text-lg font-bold text-[#ff7a59]">
                          {getCurrentExam()!.duration} min
                        </p>
                      </div>

                      <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 p-2.5 sm:p-3 rounded-lg border border-slate-200/50">
                        <div className="flex items-center mb-1">
                          <div className="w-5 h-5 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center mr-2 shadow-sm">
                            <svg
                              className="w-3 h-3 text-white"
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
                          <span className="font-semibold text-slate-800 text-xs sm:text-sm">
                            Questions
                          </span>
                        </div>
                        <p className="text-base sm:text-lg font-bold text-slate-700">
                          {getCurrentExam()!.questionCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200/50 pt-4 sm:pt-6">
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                      <button
                        onClick={closeGuidelines}
                        className="flex-1 px-5 sm:px-6 py-2.5 sm:py-3 text-slate-700 bg-gradient-to-r from-slate-100 to-slate-200 rounded-xl font-semibold hover:from-slate-200 hover:to-slate-300 transition-all duration-300 shadow-md"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          const ex = getCurrentExam();
                          if (!ex) return;
                          await handleStartExam(ex);
                          closeGuidelines();
                        }}
                        className="flex-1 inline-flex items-center justify-center bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-300 border border-[#ff7a59] shadow-md"
                      >
                        Start Exam
                        <svg
                          className="w-5 h-5 ml-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
