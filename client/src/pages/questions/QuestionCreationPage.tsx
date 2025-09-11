import { useEffect, useRef, useState } from "react";
import { generateQuestions } from "../../services/questionService";
import { createQuestion } from "../../services/questionService";
import { Sparkles, Loader2, Wand2, Plus, X } from "lucide-react";

type DifficultyLabel = "Very Easy" | "Easy" | "Medium" | "Hard" | "Very Hard";
type QType = "MCQ" | "Short Answer" | "Essay";

const DIFF_TO_NUM: Record<DifficultyLabel, 1 | 2 | 3 | 4 | 5> = {
  "Very Easy": 1,
  Easy: 2,
  Medium: 3,
  Hard: 4,
  "Very Hard": 5,
};

const DEFAULT_CHOICES = ["", "", "", ""];

export default function AiGeneratorPage() {
  // ---- AI tab state ----
  const [topic, setTopic] = useState("Algorithms");
  const [difficulty, setDifficulty] = useState<DifficultyLabel>("Medium");
  const [count, setCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"manual" | "ai">("manual");

  // ---- Manual tab state (use topic, not topic) ----
  const [manual, setManual] = useState({
    text: "",
    answer: "", // mirrors selected correct choice
    topic: "Algorithms",
    difficulty: "Medium" as DifficultyLabel,
    type: "MCQ" as QType,
    tags: "" as string,
    choices: [...DEFAULT_CHOICES] as string[],
  });

  // ───────────────────────────── Helpers ─────────────────────────────

  // tiny Select used in both tabs
  function Select({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: string[];
  }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      const onDoc = (e: MouseEvent) => {
        if (!ref.current) return;
        if (!ref.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm bg-white hover:bg-slate-50"
        >
          {value}
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-300 bg-white shadow">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm capitalize transition-colors ${
                  opt === value
                    ? "bg-slate-200 text-slate-900"
                    : "text-slate-900"
                } hover:bg-slate-300/60`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /** Map manual form into the backend payload (BE expects these names). */
  function toCreatePayload(item: {
    text: string;
    // use either `topic` OR `topic` locally; we map to `topic` for BE
    topic?: string;
    difficulty: DifficultyLabel;
    type: QType;
    answer: string;
    choices?: string[];
  }) {
    const options =
      item.type === "MCQ"
        ? (item.choices ?? []).map((c) => c.trim()).filter(Boolean)
        : [];

    let correctIndex = options.findIndex((c) => c === item.answer.trim());
    if (item.type === "MCQ") {
      if (correctIndex === -1 && item.answer.trim()) {
        options.push(item.answer.trim());
        correctIndex = options.length - 1;
      }
      if (correctIndex === -1) correctIndex = 0;
    } else {
      correctIndex = 0; // BE ignores options for non-MCQ
    }

    const tagsArr = (manual.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // 👇 IMPORTANT: always provide `topic` in the BODY for manual create
    const topicVal = (item.topic ?? item.topic ?? "").trim() || "Uncategorized";

    return {
      question_text: item.text.trim(),
      options,
      correct_answer: correctIndex,
      difficulty: DIFF_TO_NUM[item.difficulty],
      topic: item.topic?.trim() || "Uncategorized",
      tags: (manual.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      type: item.type,
    };
  }

  const addChoice = () =>
    setManual((m) =>
      m.choices.length >= 5 ? m : { ...m, choices: [...m.choices, ""] }
    );

  const removeChoice = (index: number) =>
    setManual((m) => {
      if (m.choices.length <= 2) return m; // keep at least 2
      const removed = m.choices[index]?.trim() ?? "";
      const nextChoices = m.choices.filter((_, i) => i !== index);
      const nextAnswer = m.answer.trim() === removed ? "" : m.answer;
      return { ...m, choices: nextChoices, answer: nextAnswer };
    });

  const updateChoice = (index: number, value: string) =>
    setManual((m) => {
      const prev = m.choices[index] ?? "";
      const wasCorrect = m.answer.trim() === prev.trim();
      const nextChoices = m.choices.slice();
      nextChoices[index] = value;
      return {
        ...m,
        choices: nextChoices,
        answer: wasCorrect ? value : m.answer,
      };
    });

  const markCorrect = (index: number) =>
    setManual((m) => ({ ...m, answer: (m.choices[index] ?? "").trim() }));

  // ───────────────────────────── AI generate handler ─────────────────────────────

  async function handleGenerate() {
    setLoading(true);

    const safeTopic = String(topic ?? "").trim();
    const toNum = (v: unknown, def: number, lo: number, hi: number) => {
      const n = typeof v === "number" ? v : Number(v);
      const x = Number.isFinite(n) ? n : def;
      return Math.min(hi, Math.max(lo, x));
    };

    const diffNum = toNum(difficulty, 3, 1, 5);
    const countN = toNum(count, 5, 1, 50);

    setLog((l) => [
      ...l,
      `Generating ${countN} question(s) with difficulty ${diffNum} for "${
        safeTopic || "(missing topic)"
      }"...`,
    ]);

    if (!safeTopic) {
      setLog((l) => [
        ...l,
        'Please enter a topic (e.g., "Algorithms") before generating.',
      ]);
      setLoading(false);
      return;
    }

    try {
      // ✅ send topic in BODY (not query)
      const res: any = await generateQuestions({
        topic: safeTopic,
        difficulty: diffNum,
        count: countN,
      });

      if (res?.inserted !== undefined) {
        setLog((l) => [
          ...l,
          `Generation complete. Inserted ${res.inserted} questions.`,
        ]);
      } else if (Array.isArray(res?.items)) {
        setLog((l) => [
          ...l,
          `Generation complete. Items returned: ${res.items.length}.`,
        ]);
      } else {
        setLog((l) => [...l, "Generation request accepted."]);
      }
    } catch (e: any) {
      console.error("generateQuestions error", {
        status: e?.status,
        message: e?.message,
        payload: e?.payload,
      });
      setLog((l) => [
        ...l,
        `Generation failed: ${e?.message ?? "Unknown error"}`,
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ───────────────────────────── UI ─────────────────────────────

  const hasEnoughChoices = manual.choices.filter((c) => c.trim()).length >= 2;
  const answerMatchesChoice =
    manual.type !== "MCQ" ||
    manual.answer.trim().length === 0 ||
    manual.choices.map((c) => c.trim()).includes(manual.answer.trim());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[#ff7a59] p-2 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-slate-800">
              Create Questions
            </div>
            <div className="text-xs text-slate-600">
              Add questions manually or generate with AI
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              activeTab === "manual"
                ? "border-slate-300 bg-slate-100 text-slate-800"
                : "border-transparent bg-white hover:bg-slate-50 text-slate-600"
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ai")}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              activeTab === "ai"
                ? "border-slate-300 bg-slate-100 text-slate-800"
                : "border-transparent bg-white hover:bg-slate-50 text-slate-600"
            }`}
          >
            AI Generator
          </button>
        </div>
      </div>

      {/* Manual Tab */}
      {activeTab === "manual" && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* topic (manual) */}
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-slate-700">
                topic / Topic
              </label>
              <input
                value={manual.topic}
                onChange={(e) =>
                  setManual((m) => ({ ...m, topic: e.target.value }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                placeholder="e.g., Algorithms"
              />
            </div>

            {/* Difficulty */}
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-slate-700">
                Difficulty
              </label>
              <Select
                value={manual.difficulty}
                onChange={(v) =>
                  setManual((m) => ({ ...m, difficulty: v as DifficultyLabel }))
                }
                options={["Very Easy", "Easy", "Medium", "Hard", "Very Hard"]}
              />
            </div>

            {/* Type */}
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-slate-700">Type</label>
              <Select
                value={manual.type}
                onChange={(v) => setManual((m) => ({ ...m, type: v as QType }))}
                options={["MCQ", "Short Answer", "Essay"]}
              />
            </div>

            {/* Tags */}
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-slate-700">
                Tags (comma separated)
              </label>
              <input
                value={manual.tags}
                onChange={(e) =>
                  setManual((m) => ({ ...m, tags: e.target.value }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                placeholder="algorithms, sorting, arrays"
              />
            </div>
          </div>

          {/* Question text */}
          <div className="mt-4 grid gap-1.5">
            <label className="text-xs font-medium text-slate-700">
              Question
            </label>
            <textarea
              value={manual.text}
              onChange={(e) =>
                setManual((m) => ({ ...m, text: e.target.value }))
              }
              rows={4}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
              placeholder="Type your question..."
            />
          </div>

          {/* MCQ Choices */}
          {manual.type === "MCQ" && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">
                  Choices
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addChoice}
                    disabled={manual.choices.length >= 5}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Add one more choice (max 5)"
                  >
                    <Plus className="h-3 w-3" /> Add Choice
                  </button>
                  <span className="text-xs text-gray-500">
                    {manual.choices.length}/5 choices
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {manual.choices.map((choice, index) => {
                  const id = `correct-${index}`;
                  const trimmed = choice.trim();
                  const isCorrect =
                    trimmed.length > 0 && manual.answer.trim() === trimmed;

                  return (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        id={id}
                        type="radio"
                        name="correct"
                        className="h-4 w-4"
                        disabled={!trimmed}
                        checked={isCorrect}
                        onChange={() => markCorrect(index)}
                        title="Mark this choice as correct"
                      />
                      <label htmlFor={id} className="sr-only">
                        Mark as correct
                      </label>

                      <span className="w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs font-medium text-gray-600 bg-white flex-shrink-0">
                        {String.fromCharCode(65 + index)}
                      </span>

                      <input
                        value={choice}
                        onChange={(e) => updateChoice(index, e.target.value)}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                        placeholder={`Option ${String.fromCharCode(
                          65 + index
                        )}`}
                      />

                      {manual.choices.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeChoice(index)}
                          className="inline-flex items-center justify-center w-6 h-6 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                          title="Remove this choice"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 space-y-2">
                {hasEnoughChoices && answerMatchesChoice ? (
                  <div className="text-green-700 bg-green-50 border border-green-200 p-2 rounded-md text-sm">
                    ✅ MCQ validation passed! Picked answer matches one of the
                    choices.
                  </div>
                ) : (
                  <div className="text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-md text-sm">
                    ⚠️ MCQ validation:
                    {!hasEnoughChoices
                      ? " Need at least 2 choices"
                      : " Pick a correct choice using the round selector on the left"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Save manual question */}
          <div className="mt-5">
            <button
              onClick={async () => {
                if (!manual.text.trim()) return;

                if (manual.type === "MCQ") {
                  const validChoices = manual.choices
                    .map((c) => c.trim())
                    .filter(Boolean);
                  if (validChoices.length < 2) {
                    alert("MCQ questions must have at least 2 choices");
                    return;
                  }
                  if (!validChoices.includes(manual.answer.trim())) {
                    alert(
                      "Select a correct choice using the radio to the left of the option."
                    );
                    return;
                  }
                } else {
                  if (!manual.answer.trim()) {
                    alert("Please provide an answer.");
                    return;
                  }
                }

                const payload = toCreatePayload({ ...manual });
                await createQuestion(payload); // ✅ body-only; no query params
                setLog((l) => [
                  ...l,
                  "Manually added 1 question. Pending review.",
                ]);

                // reset form
                setManual({
                  text: "",
                  answer: "",
                  topic: "Algorithms",
                  difficulty: "Medium",
                  type: "MCQ",
                  tags: "",
                  choices: [...DEFAULT_CHOICES],
                });
              }}
              className="w-full rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Add Question
            </button>

            <div className="my-2 h-px w-full bg-gray-200" />
            <div className="text-xs text-gray-600">
              New questions go to Approvals and will appear in the bank once
              approved.
            </div>
          </div>
        </div>
      )}

      {/* AI Generator Tab (unchanged) */}
      {activeTab === "ai" && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Topic
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
            placeholder="e.g., Algorithms"
          />

          <label className="block text-xs font-medium text-slate-700 mb-1">
            Difficulty
          </label>
          <Select
            value={difficulty}
            onChange={(v) => setDifficulty(v as DifficultyLabel)}
            options={["Very Easy", "Easy", "Medium", "Hard", "Very Hard"]}
          />

          <div className="mt-3 grid gap-1.5">
            <label className="text-xs font-medium text-slate-700">
              How many?
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
              }
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Generate & Save
          </button>

          {log.length > 0 && (
            <div className="mt-4 space-y-2 text-xs">
              {log.map((l, i) => (
                <div
                  key={i}
                  className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-700"
                >
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
