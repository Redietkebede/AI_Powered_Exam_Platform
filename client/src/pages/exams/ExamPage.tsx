import { useEffect, useRef, useState } from "react";
import { startAttempt } from "../../services/examService";
import type { Question } from "../../types/question";
import { submitExam } from "../../services/answers";
import { getPublishedQuestions } from "../../services/questionService";
import type { DbQuestionRow as dbQuestionRow } from "../../adapters/dbQuestionRow";
import { getSessionQuestions } from "../../services/sessions";
import { getRemaining } from "../../services/examService"; // optional if you add a BE sync endpoint
type Answer = { choiceIndex?: number; text?: string };

/* -------------------- helpers -------------------- */

const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

// Map numeric -> label your Question type uses
const toDifficultyLabel = (n?: unknown): Question["difficulty"] => {
  const lvl = toDifficultyNum(n); // clamps to 1..5, defaults to 3
  return lvl <= 1
    ? "Very Easy"
    : lvl === 2
    ? "Easy"
    : lvl === 3
    ? "Medium"
    : lvl === 4
    ? "Hard"
    : "Very Hard";
};

const levelToElo = (n?: number) => {
  const L = Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  return L === 1
    ? 900
    : L === 2
    ? 1000
    : L === 3
    ? 1100
    : L === 4
    ? 1200
    : 1300;
};

// Keep a numeric difficulty too (used by adaptive pick)
const toDifficultyNum = (n?: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 3;
  return Math.max(1, Math.min(5, Math.round(v)));
};

// safe ms → seconds (>=1)
const toSecs = (ms: number) => Math.max(1, Math.round(ms / 1000) || 1);

// Build bulk payload from local buffer
function buildBulkPayload(
  sessionId: number,
  selections: Record<number, { choiceIndex: number; timeTakenSeconds: number }>
) {
  const answers = Object.entries(selections).map(([qid, v]) => ({
    questionId: Number(qid),
    selectedIndex: Number.isFinite(v.choiceIndex) ? v.choiceIndex : 0,
    timeTakenSeconds: toSecs(Number(v.timeTakenSeconds) || 0),
  }));
  return { sessionId, answers };
}

/* -------------------- component -------------------- */

export default function ExamPage() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [progress, setProgress] = useState({ index: 0, total: 0, correct: 0 });

  // per-question timer (already existed)
  const [timer, setTimer] = useState(60);
  const [perQuestionSeconds, setPerQuestionSeconds] = useState(60);
  const timerRef = useRef<number | null>(null);

  // ✅ total exam countdown (hard stop)
  const [totalTimer, setTotalTimer] = useState<number | null>(null);
  const totalTimerRef = useRef<number | null>(null);

  const [answer, setAnswer] = useState<Answer>({});
  const [finished, setFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const questionStartRef = useRef<number | null>(null);
  const [pool, setPool] = useState<Question[]>([]);
  const autoSubmittedRef = useRef(false);
  const [emptyPool, setEmptyPool] = useState(false);
  const [totalSeconds, setTotalSeconds] = useState<number | null>(null);

  // ✅ prevents re-seeding/overwriting server values
  const seededRef = useRef(false);

  // Buffer of all selections in this attempt (questionId -> selection)
  const [selections, setSelections] = useState<
    Record<number, { choiceIndex: number; timeTakenSeconds: number }>
  >({});

  // this MUST be the server session/attempt id for answers API
  const sessionIdRef = useRef<number | null>(null);
  const movingRef = useRef(false); // guard: prevents double advance / double submit

  // keep a simple stack to support "Previous"
  const [questionHistory, setQuestionHistory] = useState<
    Array<{ question: Question; answer: Answer; timeSpentMs: number }>
  >([]);

  // Normalize a DB row/object into your Question shape — be generous:
  const toQuestion = (q: any): Question => {
    const id = Number(q.questionId ?? q.id);

    // text
    const text = q.questionText ?? q.text ?? q.question_text ?? q.prompt ?? "";

    // choices from multiple shapes
    const fourPack = [
      q.option_a ?? q.optionA ?? q.option1,
      q.option_b ?? q.optionB ?? q.option2,
      q.option_c ?? q.optionC ?? q.option3,
      q.option_d ?? q.optionD ?? q.option4,
    ].filter((x) => typeof x === "string" && x.trim().length > 0) as string[];

    const choicesRaw = (q.options ?? q.choices ?? fourPack ?? []) as string[];
    const choices = choicesRaw.filter(
      (c) => typeof c === "string" && c.trim() !== ""
    );

    // correct index: accept 0-based, 1-based, or text answer
    let ci: number = Number(
      q.correctIndex ??
        q.correct_index ??
        q.correct_option ??
        q.correctAnswer ??
        q.correct_answer
    );
    if (!Number.isFinite(ci)) {
      // maybe the "answer" is the text of the choice
      const textAns = String(q.answer ?? "").trim();
      const idxFromText = choices.findIndex(
        (c) => c.trim().toLowerCase() === textAns.toLowerCase()
      );
      ci = idxFromText >= 0 ? idxFromText : 0;
    } else {
      // if it's 1..4, convert to 0..3
      if (ci >= 1 && ci <= 4 && choices.length >= ci) ci = ci - 1;
      // clamp
      ci = Math.max(0, Math.min(ci, Math.max(0, choices.length - 1)));
    }

    const diffRaw =
      q.difficulty ??
      q.numericDifficulty ??
      q.difficulty_level ??
      q.level ??
      q.difficultyLevel;

    return {
      id,
      text,
      choices,
      correctIndex: ci,
      // renderer parity
      options: choices,
      answer: String(ci), // your Question type expects string
      type: (q.type ?? "MCQ") as Question["type"],
      difficulty: toDifficultyLabel(diffRaw),
      numericDifficulty: toDifficultyNum(diffRaw),
      status: (q.status ?? "published") as Question["status"],
      tags: (q.tags ?? []) as string[],
    };
  };

  /* ---------- initial load: session resume OR legacy start ---------- */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const attemptFromUrl = params.get("attemptId");

        // 1) Resume existing session by attemptId
        if (attemptFromUrl) {
          const sid = Number(attemptFromUrl);
          if (!Number.isFinite(sid) || sid <= 0) {
            setEmptyPool(true);
            return;
          }

          setAttemptId(String(sid));
          sessionIdRef.current = sid;

          const snap = await getSessionQuestions(sid);
          if (snap && typeof (snap as any).total_time_seconds === "number") {
            setTotalSeconds((snap as any).total_time_seconds);
          }

          const mapped: Question[] = (Array.isArray(snap) ? snap : []).map(
            toQuestion
          );

          if (!alive) return;
          if (mapped.length === 0) {
            setEmptyPool(true);
            return;
          }

          // set pool & total
          setPool(mapped);
          setProgress((p) => ({ ...p, total: mapped.length }));

          // 🔑 FIRST QUESTION BY INDEX (no stateful helper)
          const first = mapped[0];
          if (!first) {
            setEmptyPool(true);
            return;
          }
          setQuestion(first);
          questionStartRef.current = performance.now();

          // Per-question timer keeps your previous UX
          setPerQuestionSeconds(60);
          setTimer(60);

          // —— seed the single total exam timer ——
          try {
            const sid2 = sessionIdRef.current;
            if (sid2) {
              const j = await getRemaining(sid2);
              if (typeof j.total === "number" && j.total > 0)
                setTotalSeconds(j.total);

              let seeded = false;
              if (typeof j.remaining === "number") {
                setTotalTimer(Math.max(0, Math.floor(j.remaining)));
                seeded = true;
              } else if (j.deadlineAt) {
                const secs = Math.max(
                  0,
                  Math.floor(
                    (new Date(j.deadlineAt).getTime() - Date.now()) / 1000
                  )
                );
                setTotalTimer(secs);
                seeded = true;
              }
              if (seeded) seededRef.current = true;
            }
          } catch {
            /* ignore */
          }

          // Fallback only if BE gave nothing and we didn’t seed yet
          if (!seededRef.current) {
            const fallbackTotal =
              typeof totalSeconds === "number" && totalSeconds > 0
                ? totalSeconds
                : 60 * (mapped.length || 0);
            setTotalTimer(fallbackTotal);
            seededRef.current = true;
          }

          return;
        }

        // 2) Legacy path: start a new attempt from testId
        const rawTestId =
          params.get("testId") ||
          params.get("assignmentId") ||
          params.get("examId") ||
          undefined;

        const testId =
          rawTestId != null && rawTestId !== "" ? Number(rawTestId) : undefined;

        if (!Number.isFinite(testId) || (testId as number) <= 0) {
          setEmptyPool(true);
          return;
        }

        // optional assignment config stored locally
        let topicFilter: string | undefined;
        let ids: Array<string | number> = [];
        let perQSeconds = 60;

        try {
          const raw = localStorage.getItem("ai_exam_assignments_v2");
          if (raw) {
            const list: any[] = JSON.parse(raw);
            const a = list.find((x) => String(x.id) === String(testId));
            if (a) {
              topicFilter =
                (typeof a?.config?.topic === "string" &&
                  a.config.topic.trim()) ||
                (Array.isArray(a?.config?.topics) && a.config.topics[0]
                  ? String(a.config.topics[0]).trim()
                  : undefined);
              ids = Array.isArray(a?.questionIds) ? a.questionIds : [];
            }
          }
        } catch {
          /* ignore malformed storage */
        }

        // fetch bank questions
        let bank: Question[] = [];
        try {
          const rawBank = await getPublishedQuestions({
            topic: topicFilter ?? "",
            limit: 1000,
          });
          const dbRows: any[] = Array.isArray(rawBank)
            ? rawBank
            : (rawBank as { items: dbQuestionRow[] })?.items ?? [];
          bank = dbRows.map(toQuestion);
        } catch {
          bank = [];
        }

        // constrain to explicit questionIds if assignment preselected
        if (ids.length) {
          const allow = new Set(ids.map(String));
          bank = bank.filter((q: any) => allow.has(String(q.id)));
        }

        // MCQ only
        const mcq = bank.filter((q: any) => (q.type ?? "MCQ") === "MCQ");
        if (!alive) return;

        if (mcq.length === 0) {
          setEmptyPool(true);
          return;
        }

        setPool(mcq as any);
        setProgress((p) => ({ ...p, total: mcq.length }));

        // ✅ start attempt; let BE pick questions freely (DON'T pass topics)
        let newAttemptId: number | null = null;
        try {
          newAttemptId = await startAttempt({
            testId: testId as number,
            // topics: topicFilter ? [topicFilter] : undefined,
            limit: mcq.length,
          });
        } catch (e: any) {
          const msg = String(e?.message ?? "");
          if (/no published questions/i.test(msg)) {
            setEmptyPool(true);
            return;
          }
          console.error("startAttempt failed:", e);
          alert("Failed to start the exam. Please try again.");
          return;
        }

        if (!newAttemptId) {
          setEmptyPool(true);
          return;
        }

        setAttemptId(String(newAttemptId));
        sessionIdRef.current = Number(newAttemptId);

        // FIRST QUESTION BY INDEX
        const first = mcq[0];
        if (!first) {
          setEmptyPool(true);
          return;
        }
        setQuestion(first);
        questionStartRef.current = performance.now();

        // Keep your per-question UX the same
        setPerQuestionSeconds(perQSeconds);
        setTimer(perQSeconds);

        // —— seed the single total exam timer ——
        try {
          const sid = sessionIdRef.current;
          if (sid) {
            const j = await getRemaining(sid);

            if (typeof j.total === "number" && j.total > 0)
              setTotalSeconds(j.total);

            let seeded = false;
            if (typeof j.remaining === "number") {
              setTotalTimer(Math.max(0, Math.floor(j.remaining)));
              seeded = true;
            } else if (j.deadlineAt) {
              const secs = Math.max(
                0,
                Math.floor(
                  (new Date(j.deadlineAt).getTime() - Date.now()) / 1000
                )
              );
              setTotalTimer(secs);
              seeded = true;
            }
            if (seeded) seededRef.current = true;
          }
        } catch {
          /* ignore */
        }

        // ✅ Fallback ONLY if nothing was seeded from BE
        if (!seededRef.current) {
          const fallbackTotal =
            typeof totalSeconds === "number" && totalSeconds > 0
              ? totalSeconds
              : perQSeconds * (mcq.length || 0);
          setTotalTimer(fallbackTotal);
          seededRef.current = true;
        }
      } catch (e) {
        console.error("ExamPage init error:", e);
        if (!alive) return;
        setEmptyPool(true);
      }
    })();

    return () => {
      // clean intervals if we unmount while running
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (totalTimerRef.current) window.clearInterval(totalTimerRef.current);
    };
  }, []);

  /* ---------- side effects ---------- */

  // Per-question countdown (existing behavior)
  useEffect(() => {
    if (finished) return;
    timerRef.current = window.setInterval(
      () => setTimer((t) => (t > 0 ? t - 1 : 0)),
      1000
    );
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [finished]);

  // Auto-advance when per-question timer hits 0 (once per question)
  useEffect(() => {
    if (finished) return;
    if (timer === 0 && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      handleSubmit();
    }
  }, [timer, finished]);

  // Reset auto-submit guard as soon as a new timer (>0) is active
  useEffect(() => {
    if (timer > 0) autoSubmittedRef.current = false;
  }, [timer]);

  // ✅ Session-wide countdown (hard stop)
  useEffect(() => {
    if (finished) return;
    if (totalTimer == null) return;

    totalTimerRef.current = window.setInterval(() => {
      setTotalTimer((t) => (t != null && t > 0 ? t - 1 : 0));
    }, 1000);

    return () => {
      if (totalTimerRef.current) window.clearInterval(totalTimerRef.current);
    };
  }, [finished, totalTimer != null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ When total time hits zero -> finalize the whole exam
  useEffect(() => {
    if (finished) return;
    if (totalTimer === 0) {
      finalizeExam({ includeCurrent: true });
    }
  }, [totalTimer, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- actions ---------- */

  async function handleSubmit() {
    if (!question) return;

    const start = questionStartRef.current ?? performance.now();
    const timeSpentMs = performance.now() - start;

    // guard: only MCQ for now
    if ((question.type ?? "MCQ") !== "MCQ") {
      alert("Only multiple-choice questions are supported right now.");
      return;
    }
    if (typeof answer.choiceIndex !== "number") {
      alert("Please select an option before submitting.");
      return;
    }

    // guard: index must be within options
    const options = (question.choices ??
      (question as any).options ??
      []) as string[];
    const maxIdx = Math.max(0, options.length - 1);
    if (answer.choiceIndex < 0 || answer.choiceIndex > maxIdx) {
      alert("Invalid option index.");
      return;
    }

    // 1) Buffer locally (no API here)
    setSelections((prev) => ({
      ...prev,
      [Number(question.id)]: {
        choiceIndex: answer.choiceIndex!,
        timeTakenSeconds: toSecs(timeSpentMs),
      },
    }));

    // 2) Advance deterministically by index; finalize only after the LAST question
    setQuestionHistory((prev) => [...prev, { question, answer, timeSpentMs }]);
    setTimer(perQuestionSeconds);
    setAnswer({});

    setProgress((p) => {
      const nextIndex = p.index + 1;

      // When we've just answered the last question (nextIndex === total), finalize
      if (nextIndex >= p.total) {
        // includeCurrent is false because we already buffered it above
        finalizeExam({ includeCurrent: true });
        return { ...p, index: nextIndex };
      }

      // Otherwise move to the next question by index
      const nextQ = pool[nextIndex];
      if (nextQ) {
        setQuestion(nextQ);
        questionStartRef.current = performance.now();

        const L = Number(
          (nextQ as any).numericDifficulty ?? (nextQ as any).difficulty ?? 3
        );
        const numeric = Math.max(1, Math.min(5, Math.round(L)));
        const label =
          numeric <= 1
            ? "Very Easy"
            : numeric === 2
            ? "Easy"
            : numeric === 3
            ? "Medium"
            : numeric === 4
            ? "Hard"
            : "Very Hard";

        console.groupCollapsed(
          "[Adaptive] Next Question",
          `#${
            (nextQ as any).id ?? "?"
          } — ${label} (L${numeric}, ELO ${levelToElo(numeric)})`
        );
        console.table({
          id: (nextQ as any).id,
          difficultyLabel: label,
          difficultyLevel: numeric,
          predictedElo: levelToElo(numeric),
          textPreview:
            (nextQ as any).text ??
            (nextQ as any).question_text ??
            (nextQ as any).prompt ??
            "n/a",
        });
        console.groupEnd();
      }

      return { ...p, index: nextIndex };
    });
  }

  async function finalizeExam(
    opts: { includeCurrent: boolean } = { includeCurrent: true }
  ) {
    // avoid double finalize
    if (movingRef.current) return;
    movingRef.current = true;

    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      alert("Missing session id.");
      movingRef.current = false;
      return;
    }

    // Safely build a fresh answers map (avoid mutating React state)
    const map: Record<
      number,
      { choiceIndex: number; timeTakenSeconds: number }
    > = {
      ...selections,
    };

    if (
      opts.includeCurrent &&
      question &&
      typeof answer.choiceIndex === "number"
    ) {
      const ms =
        performance.now() - (questionStartRef.current ?? performance.now());
      const qid = Number(question.id);
      if (!map[qid]) {
        map[qid] = {
          choiceIndex: answer.choiceIndex,
          timeTakenSeconds: toSecs(ms),
        };
      }
    }

    const { answers } = buildBulkPayload(sessionId, map);
    if (answers.length === 0) {
      // Even if empty, mark finished to end the UI flow
      setFinished(true);
      movingRef.current = false;
      return;
    }

    try {
      const summary = await submitExam({ sessionId, answers });
      setProgress((p) => ({
        ...p,
        index: p.total,
        correct: summary?.correctAnswers ?? summary?.correct ?? p.correct,
      }));
      setFinished(true);
    } catch (e) {
      console.error("submitExam failed:", e);
      alert("Failed to submit exam. Please try again.");
    } finally {
      movingRef.current = false;
      // stop timers
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (totalTimerRef.current) window.clearInterval(totalTimerRef.current);
    }
  }

  function handleBack() {
    if (questionHistory.length === 0) return;
    const last = questionHistory[questionHistory.length - 1];
    setQuestionHistory((prev) => prev.slice(0, -1));
    setQuestion(last.question);
    setAnswer(last.answer);
    setProgress((p) => ({ ...p, index: Math.max(0, p.index - 1) }));
    setTimer(perQuestionSeconds);
    questionStartRef.current = performance.now();
  }

  /* ---------- render ---------- */

  if (finished) {
    const score =
      progress.total > 0
        ? Math.round((progress.correct / progress.total) * 100)
        : 0;

    if (!showResults) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/30 p-8 max-w-sm w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-slate-800 mb-3">
                Exam Completed!
              </h1>
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                Great job! You've finished the exam successfully.
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => setShowResults(true)}
                  className="w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-4 py-3 rounded-xl font-medium hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-200 hover:shadow-lg shadow-md"
                >
                  View Results
                </button>
                <button
                  onClick={() => (window.location.href = "/app/dashboard")}
                  className="w-full bg-slate-100 text-slate-600 px-4 py-3 rounded-xl font-medium hover:bg-slate-200 transition-all duration-200 border border-slate-200"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/30 p-8 max-w-sm w-full">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2 2v6a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-5">
              Your Results
            </h1>

            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-5 border border-slate-200/50 mb-5">
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide font-medium">
                Final Score
              </p>
              <p className="text-2xl font-bold text-slate-800 mb-1">
                {progress.total > 0
                  ? Math.round((progress.correct / progress.total) * 100)
                  : 0}
                %
              </p>
              <p className="text-xs text-slate-500">
                {progress.correct} of {progress.total} correct
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/50 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">
                    Questions
                  </p>
                  <p className="text-lg font-semibold text-slate-700">
                    {progress.total}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">
                    Correct
                  </p>
                  <p className="text-lg font-semibold text-slate-700">
                    {progress.correct}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => (window.location.href = "/app/dashboard")}
              className="w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-4 py-3 rounded-xl font-medium hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-200 hover:shadow-lg shadow-md"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 p-4">
      <div className="max-w-4xl mx-auto">
        {emptyPool && (
          <div className="bg-white border border-amber-200 text-amber-800 rounded-xl p-4 mb-4">
            No approved MCQ questions found in the Question Bank. Please add
            approved MCQs to start the exam.
          </div>
        )}

        {/* Header */}
        <div className="bg-gradient-to-br from-white via-slate-50 to-slate-100 rounded-3xl shadow-lg border border-slate-200/50 p-5 sm:p-6 mb-5 sm:mb-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-2xl flex items-center justify-center mr-3 sm:mr-4 shadow-lg">
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6 text-white"
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
                <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
                  Exam Session
                </h1>
                <p className="text-slate-600 text-xs sm:text-sm">
                  Question {progress.index + 1} of {progress.total}
                </p>
              </div>
            </div>

            {/* Timers */}
            <div className="flex items-center gap-2">
              {/* Total exam timer */}
              {(totalTimer != null ||
                (typeof totalSeconds === "number" && totalSeconds > 0)) && (
                <div className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-semibold text-base sm:text-lg bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border border-slate-300">
                  <div className="flex items-center">
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 mr-2"
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
                    Total&nbsp;
                    {fmt(
                      typeof totalTimer === "number"
                        ? totalTimer
                        : typeof totalSeconds === "number" && totalSeconds > 0
                        ? totalSeconds
                        : 0
                    )}
                  </div>
                </div>
              )}

              {/* Per-question timer (existing; disabled visually) */}
              {false && (
                <div
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 ${
                    timer <= 10
                      ? "bg-gradient-to-r from-red-100 to-red-200 text-red-700 border border-red-300"
                      : timer <= 30
                      ? "bg-gradient-to-r from-orange-100 to-orange-200 text-orange-700 border border-orange-300"
                      : "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border border-slate-300"
                  }`}
                >
                  <div className="flex items-center">
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 mr-2"
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
                    {Math.floor(timer / 60)}:
                    {(timer % 60).toString().padStart(2, "0")}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-gradient-to-br from-white to-slate-50/50 rounded-3xl shadow-lg border border-slate-200/50 p-6 sm:p-8">
          {question ? (
            <>
              {/* Question Header */}
              <div className="mb-5 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-slate-800 leading-relaxed">
                  {question.text ??
                    (question as any).question_text ??
                    (question as any).prompt}
                </h2>
              </div>

              {/* Answer Options */}
              {question.type === "MCQ" && (
                <div className="space-y-3 mb-6 sm:mb-8">
                  {(
                    question.choices ??
                    (question as any).options ?? [
                      "Option 1",
                      "Option 2",
                      "Option 3",
                      "Option 4",
                    ]
                  ).map((label: string, idx: number) => (
                    <label
                      key={idx}
                      className={`group cursor-pointer block transition-all duration-300 ${
                        answer.choiceIndex === idx
                          ? "bg-gradient-to-r from-slate-100 to-slate-200 border-slate-300"
                          : "bg-gradient-to-r from-slate-50 to-slate-100/50 border-slate-200/50 hover:from-slate-100 hover:to-slate-200/50"
                      } border-2 rounded-xl p-4 hover:shadow-md hover:scale-[1.01]`}
                    >
                      <div className="flex items-center">
                        <div
                          className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center mr-3 sm:mr-4 transition-all duration-300 ${
                            answer.choiceIndex === idx
                              ? "border-slate-600 bg-slate-600"
                              : "border-slate-300 group-hover:border-slate-400"
                          }`}
                        >
                          {answer.choiceIndex === idx && (
                            <div className="w-2 h-2 bg-white rounded-full" />
                          )}
                        </div>
                        <input
                          type="radio"
                          name="mcq"
                          checked={answer.choiceIndex === idx}
                          onChange={() => setAnswer({ choiceIndex: idx })}
                          className="sr-only"
                        />
                        <span className="text-slate-800 text-sm sm:text-base font-medium">
                          {label}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Text Answer (not persisted) */}
              {question.type !== "MCQ" && (
                <div className="mb-6 sm:mb-8">
                  <textarea
                    value={answer.text ?? ""}
                    onChange={(e) => setAnswer({ text: e.target.value })}
                    className="w-full rounded-xl border-2 border-slate-200/50 px-3 sm:px-4 py-3 text-slate-800 placeholder-slate-500 focus:border-[#ff7a59]/50 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/20 transition-all duration-300 bg-gradient-to-r from-slate-50 to-slate-100/50"
                    rows={6}
                    placeholder="Write your detailed answer here..."
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 pt-5 sm:pt-6 border-t border-slate-200/50">
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <button
                    onClick={handleBack}
                    disabled={questionHistory.length === 0}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-medium transition-all duration-300 ${
                      questionHistory.length === 0
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 hover:from-slate-200 hover:to-slate-300 hover:scale-[1.02] shadow-md border border-slate-300/50"
                    }`}
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
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    <span>Previous</span>
                  </button>
                  <div className="flex items-center text-xs sm:text-sm text-slate-600 bg-gradient-to-r from-slate-50 to-slate-100/50 px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200/50">
                    <svg
                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-2 text-[#ff7a59]"
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
                    Adaptive Mode
                  </div>
                </div>
                <button
                  onClick={handleSubmit}
                  className="bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold hover:from-slate-700 hover:to-slate-800 transition-all duration-300 hover:shadow-lg border border-[#ff7a59] shadow-md hover:scale-[1.02] flex items-center justify-center space-x-2"
                >
                  <span>
                    {progress.index + 1 >= progress.total
                      ? "Finish Exam"
                      : "Submit & Next"}
                  </span>
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
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg
                  className="w-8 h-8 text-slate-600"
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
              <p className="text-slate-600 text-lg font-medium">
                Loading next question...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
