import { useEffect, useMemo, useRef, useState } from 'react'
import { aiGenerateQuestions } from '../../services/aiService'
import { createQuestion } from '../../services/questionService'
import { Sparkles, Loader2, Wand2, Plus, Minus, CheckCircle2, Info, X } from 'lucide-react'

export default function AiGeneratorPage() {
  const [topic, setTopic] = useState('Algorithms')
  const [difficulty, setDifficulty] = useState<'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard'>('Medium')
  const [count, setCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual')
  const [manual, setManual] = useState({
    text: '',
    answer: '',
    subject: 'Algorithms',
    difficulty: 'Medium' as 'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard',
    type: 'MCQ' as 'MCQ' | 'Short Answer' | 'Essay',
    tags: '' as string,
    choices: ['', '', '', ''] as string[],
  })
  
  // Helper functions for MCQ choices management
  const addChoice = () => {
    if (manual.choices.length < 5) { // Limit to 5 choices
      setManual(m => ({ ...m, choices: [...m.choices, ''] }))
    }
  }
  
  const removeChoice = (index: number) => {
    if (manual.choices.length > 2) { // Keep minimum 2 choices
      const newChoices = manual.choices.filter((_, i) => i !== index)
      setManual(m => ({ ...m, choices: newChoices }))
    }
  }
  
  const updateChoice = (index: number, value: string) => {
    const newChoices = [...manual.choices]
    newChoices[index] = value
    setManual(m => ({ ...m, choices: newChoices }))
  }

  function Select({
    value,
    onChange,
    options
  }: {
    value: string
    onChange: (v: string) => void
    options: string[]
  }) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      function onDoc(e: MouseEvent) {
        if (!ref.current) return
        if (!ref.current.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', onDoc)
      return () => document.removeEventListener('mousedown', onDoc)
    }, [])
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-slate-800 flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
        >
          <span className="truncate">{value}</span>
          <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-400 bg-white shadow-lg overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm capitalize transition-colors ${
                  opt === value ? 'bg-slate-200 text-slate-900' : 'text-slate-900'
                } hover:bg-slate-300/60`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const topicPresets = useMemo(
    () => ['Algorithms', 'Databases', 'JavaScript', 'Data Structures', 'System Design'],
    []
  )

  async function handleGenerate() {
    setLoading(true)
    setLog((l) => [...l, `Generating ${count} ${difficulty.toLowerCase()} question(s) for “${topic}”...`])
    const items = await aiGenerateQuestions({ topic, difficulty, count })
    items.forEach((q) => createQuestion({ ...q, status: 'pending' as any }))
    setLog((l) => [
      ...l,
      `Generated ${items.length} questions. Saved as pending for review and approval.`,
    ])
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#ff7a59]/10 text-[#ff7a59]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#0f2744]">Create Questions</h1>
              <p className="text-sm text-gray-600">Create questions manually or with AI. New items appear in Approvals for review.</p>
            </div>
          </div>
          <div className="hidden sm:block text-xs text-gray-600">New questions are marked <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">pending</span> until approved.</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
        {/* Tabs: Manual | AI */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 inline-flex overflow-hidden rounded-md border border-gray-200">
            {(['manual', 'ai'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-xs ${activeTab === t ? 'bg-slate-200/60 text-slate-800 border-r border-gray-200' : 'text-slate-700 hover:bg-slate-100 border-r border-gray-200'}`}
              >
                {t === 'manual' ? 'Manual' : 'AI'}
              </button>
            ))}
          </div>

          {activeTab === 'manual' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Prompt</label>
                <textarea
                  value={manual.text}
                  onChange={(e) => setManual((m) => ({ ...m, text: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                  rows={5}
                  placeholder="Write the question prompt..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Answer</label>
                <textarea
                  value={manual.answer}
                  onChange={(e) => setManual((m) => ({ ...m, answer: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                  rows={3}
                  placeholder="Reference answer..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={manual.subject}
                  onChange={(e) => setManual((m) => ({ ...m, subject: e.target.value }))}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                  placeholder="Subject"
                />
                <Select
                  value={manual.difficulty}
                  onChange={(v) => setManual((m) => ({ ...m, difficulty: v as any }))}
                  options={['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard']}
                />
                <Select
                  value={manual.type}
                  onChange={(v) => {
                    const newType = v as any
                    setManual((m) => ({ 
                      ...m, 
                      type: newType,
                      // Reset choices when changing from MCQ to other types
                      choices: newType === 'MCQ' ? ['', '', '', ''] : []
                    }))
                  }}
                  options={['MCQ', 'Short Answer', 'Essay']}
                />
              </div>
              
              {/* MCQ Choices - only show when type is MCQ */}
              {manual.type === 'MCQ' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Multiple Choice Options</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={addChoice}
                        disabled={manual.choices.length >= 5}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 rounded-md hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="h-3 w-3" /> Add Choice
                      </button>
                      <span className="text-xs text-gray-500">
                        {manual.choices.length}/5 choices
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {manual.choices.map((choice, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs font-medium text-gray-600 bg-white flex-shrink-0">
                          {String.fromCharCode(65 + index)}
                        </span>
                        <input
                          value={choice}
                          onChange={(e) => updateChoice(index, e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                          placeholder={`Option ${String.fromCharCode(65 + index)}`}
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
                    ))}
                  </div>
                  
                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-gray-600">
                      💡 <strong>Tip:</strong> Make sure one of the choices matches your answer exactly.
                    </div>
                    <div className="text-xs text-gray-500">
                      • Minimum: 2 choices • Maximum: 5 choices
                    </div>
                    
                    {/* MCQ Validation Status */}
                    {(() => {
                      const validChoices = manual.choices.filter(c => c.trim())
                      const answerMatches = validChoices.includes(manual.answer.trim())
                      const hasEnoughChoices = validChoices.length >= 2
                      
                      if (manual.answer.trim() && validChoices.length > 0) {
                        return (
                          <div className="mt-2 p-2 rounded-md text-xs">
                            {answerMatches && hasEnoughChoices ? (
                              <div className="text-green-700 bg-green-50 border border-green-200 p-2 rounded-md">
                                ✅ MCQ validation passed! Answer matches one of the choices.
                              </div>
                            ) : (
                              <div className="text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-md">
                                ⚠️ MCQ validation: {!hasEnoughChoices ? 'Need at least 2 choices' : 'Answer must match one choice exactly'}
                              </div>
                            )}
                          </div>
                        )
                      }
                      return null
                    })()}
                  </div>
                </div>
              )}
              <input
                value={manual.tags}
                onChange={(e) => setManual((m) => ({ ...m, tags: e.target.value }))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                placeholder="Tags (comma separated)"
              />
              <button
                onClick={() => {
                  if (!manual.text.trim() || !manual.answer.trim()) return
                  
                  // Validate MCQ choices
                  if (manual.type === 'MCQ') {
                    const validChoices = manual.choices.filter(c => c.trim())
                    if (validChoices.length < 2) {
                      alert('MCQ questions must have at least 2 choices')
                      return
                    }
                    if (!validChoices.includes(manual.answer.trim())) {
                      alert('The answer must match one of the choices exactly for MCQ questions')
                      return
                    }
                  }
                  
                  createQuestion({
                    text: manual.text,
                    answer: manual.answer,
                    subject: manual.subject,
                    difficulty: manual.difficulty,
                    type: manual.type,
                    status: 'pending',
                    choices: manual.type === 'MCQ' ? manual.choices.filter(c => c.trim()) : undefined,
                    tags: manual.tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                  setLog((l) => [...l, 'Manually added 1 question. Status: pending review.'])
                  setManual({ text: '', answer: '', subject: 'Algorithms', difficulty: 'Medium', type: 'MCQ', tags: '', choices: ['', '', '', ''] })
                }}
                className="w-full rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
              >
                Add Question
              </button>
              <div className="my-2 h-px w-full bg-gray-200" />
              <div className="text-xs text-gray-600">New questions go to Approvals and will appear in the bank once approved.</div>
            </div>
          )}

          {activeTab === 'ai' && (
            <>
          {/* Topic */}
          <label className="block text-sm font-medium text-gray-700">Topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., Graph algorithms, SQL joins, closures..."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {topicPresets.map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  topic === t
                    ? 'border-[#ff7a59]/40 bg-[#ff7a59]/10 text-[#0f2744]'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Difficulty */}
          <div className="mt-5">
            <div className="mb-2 text-sm font-medium text-gray-700">Difficulty</div>
            <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
              {(['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'] as const).map((d) => {
                const active = difficulty === d
                return (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`px-3 py-1.5 text-xs ${
                      active
                        ? 'bg-slate-200/60 text-slate-800 border-r border-gray-200'
                        : 'text-slate-700 hover:bg-slate-100 border-r border-gray-200'
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Count */}
          <div className="mt-5">
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700">Number of questions</label>
            </div>
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => {
                const value = parseInt(e.target.value)
                if (!isNaN(value) && value >= 1) {
                  setCount(value)
                }
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
              placeholder="Enter number of questions"
            />
            <div className="mt-1 text-xs text-gray-500">
              Enter the number of questions you want to generate
            </div>
          </div>

          {/* Generate */}
          <button
            disabled={loading || !topic.trim()}
            onClick={handleGenerate}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Generate Questions
              </>
            )}
          </button>

          <div className="mt-3 flex items-start gap-2 text-xs text-gray-600">
            <Info className="mt-0.5 h-3.5 w-3.5 text-gray-400" />
            <p>New questions go to Approvals and will appear in the bank once approved.</p>
          </div>
            </>
          )}
        </div>

        {/* Activity */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#0f2744]/10 text-[#0f2744]">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <h3 className="font-medium text-[#0f2744]">Activity</h3>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-gray-700 min-h-24">
            {log.map((item, idx) => (
              <li key={idx} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">{item}</li>
            ))}
            {log.length === 0 && (
              <li className="rounded border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-gray-500">
                No recent activity.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}


