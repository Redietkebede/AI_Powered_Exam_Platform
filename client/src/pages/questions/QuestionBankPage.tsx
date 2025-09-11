import { useMemo, useState, useEffect } from 'react'
import { getQuestions, removeQuestion } from '../../services/questionService'
import type { Question } from '../../types/question'
import { getIdToken } from '../../services/authService'
import { Plus, Search, Trash2, Eye, Filter, X, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

type Role = 'admin' | 'editor' | 'recruiter' | 'candidate'

export default function QuestionBankPage() {
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [difficulty, setDifficulty] = useState<'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard' | ''>('')
  const [type, setType] = useState<'MCQ' | 'Short Answer' | 'Essay' | ''>('')
  const [status, setStatus] = useState<Question['status'] | ''>('') // (kept for UI; we fetch approved)
  const [showFilters, setShowFilters] = useState(false)
  const [subjectQuery, setSubjectQuery] = useState('')
  const [showAllSubjects, setShowAllSubjects] = useState(false)
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())
  const [topicFilters, setTopicFilters] = useState<Record<string, { difficulty: string; type: string }>>({})
  const [user, setUser] = useState<{ role: Role } | null>(null)

  // NEW: topic + loading + error
  const [topic, setTopic] = useState<string>('')          // <- enter topic here
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [questions, setQuestions] = useState<Question[]>([]) // <- local state

  // Load current user role (unchanged)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const token = await getIdToken()
        if (!token) {
          if (alive) setUser(null)
          return
        }
        const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')
        const res = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) {
          if (alive) setUser(null)
          return
        }
        const data = (await res.json()) as { role?: Role }
        if (alive) setUser(data.role ? { role: data.role } : null)
      } catch {
        if (alive) setUser(null)
      }
    })()
    return () => { alive = false }
  }, [])

  // NEW: fetch questions for a topic (approved only)
  async function load() {
    const t = topic.trim()
    if (!t) {
      setError('Enter a topic to load questions.')
      setQuestions([])
      return
    }
    setError(null)
    setLoading(true)
    try {
      const arr = await getQuestions({ topic: t, status: 'approved', limit: 500, offset: 0 })
      setQuestions(arr ?? [])
      // reset per-topic UI state when switching topic
      setSubject('')
      setSubjectQuery('')
      setShowAllSubjects(false)
      setExpandedSubjects(new Set())
      setTopicFilters({})
    } catch (e: any) {
      console.error('QuestionBank load error', e?.status, e?.message, e?.payload)
      setError(e?.message ?? 'Failed to load questions')
      setQuestions([])
    } finally {
      setLoading(false)
    }
  }

  // Distinct subjects (display labels)
  const subjects = useMemo(() => {
    const base = Array.from(new Set(questions.map((q) => q.subject).filter(Boolean))) as string[]
    return base.sort((a, b) => a.localeCompare(b))
  }, [questions])

  // Counts per subject (used for chips)
  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of questions) {
      const key = (q.subject ?? 'Uncategorized') as string
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [questions])

  const filteredSubjects = useMemo(() => {
    if (!subjectQuery.trim()) return subjects
    const q = subjectQuery.toLowerCase()
    return subjects.filter((s) => s.toLowerCase().includes(q))
  }, [subjects, subjectQuery])

  // Global filters (client-side)
  const filtered = useMemo(() => {
    return questions.filter(
      (q) =>
        (search ? q.text.toLowerCase().includes(search.toLowerCase()) : true) &&
        (subject ? q.subject === subject : true) &&
        (difficulty ? q.difficulty === difficulty : true) &&
        (type ? q.type === type : true) &&
        (status ? q.status === status : true)
    )
  }, [search, subject, difficulty, type, status, questions])

  // Group by subject (safe key)
  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {}
    for (const q of filtered) {
      const key = (q.subject ?? 'Uncategorized').trim() || 'Uncategorized'
      ;(groups[key] ??= []).push(q)
    }
    return groups
  }, [filtered])

  // Topic-specific filtering
  const getFilteredQuestionsForTopic = (topicQuestions: Question[], subj: string) => {
    const filters = topicFilters[subj] || { difficulty: '', type: '' }
    return topicQuestions.filter(
      (q) => (filters.difficulty ? q.difficulty === filters.difficulty : true) && (filters.type ? q.type === filters.type : true)
    )
  }

  const toggleSubject = (subj: string) => {
    const next = new Set(expandedSubjects)
    next.has(subj) ? next.delete(subj) : next.add(subj)
    setExpandedSubjects(next)
  }

  const difficultyClass = (d: 'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard') => {
    if (d === 'Very Easy') return 'bg-emerald-50 text-emerald-700'
    if (d === 'Easy') return 'bg-emerald-100 text-emerald-800'
    if (d === 'Medium') return 'bg-amber-50 text-amber-700'
    if (d === 'Hard') return 'bg-rose-100 text-rose-800'
    return 'bg-rose-50 text-rose-700'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f2744]">Question Bank</h1>
          <p className="text-sm text-gray-600">
            {Object.keys(groupedQuestions).length} topics · {filtered.length} questions · {questions.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* NEW: Topic input + Apply */}
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (e.g., Algorithms)"
            className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md bg-[#0f2744] px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions"
              className="w-64 rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
            />
          </div>
          <button
            onClick={() => {
              setSearch('')
              setSubject('')
              setDifficulty('')
              setType('')
              setStatus('')
            }}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            <X className="h-4 w-4" /> Clear
          </button>
          <Link to="/app/ai-generator" className="inline-flex items-center gap-2 rounded-md bg-[#ff7a59] px-3 py-2 text-sm font-medium text-white hover:brightness-110">
            <Plus className="h-4 w-4" /> Create
          </Link>
        </div>
      </div>

      {/* Error banner (if any) */}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Topic-level filters toolbar */}
      <div className="-mx-6 border-y border-gray-200 bg-white/70 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-[#0f2744]">
            <Filter className="h-4 w-4" /> Topic Filters
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFilters(true)} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              <Filter className="h-4 w-4" /> Filter Topics
            </button>
            <button
              onClick={() => {
                setSearch('')
                setSubject('')
                setSubjectQuery('')
                setShowAllSubjects(false)
                setExpandedSubjects(new Set())
                setTopicFilters({})
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              <X className="h-4 w-4" /> Clear all
            </button>
          </div>
        </div>

        {(subject || search) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {search && (
              <button onClick={() => setSearch('')} className="group inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100">
                Search: "{search}" <X className="h-3.5 w-3.5 text-gray-500 group-hover:text-gray-700" />
              </button>
            )}
            {subject !== '' && (
              <button onClick={() => setSubject('')} className="group inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100">
                Topic: {subject} <X className="h-3.5 w-3.5 text-gray-500 group-hover:text-gray-700" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grouped Questions by Subject */}
      <div className="space-y-6">
        {!loading && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-600">
            {topic.trim() ? 'No questions found' : 'Enter a topic above and click Apply to load questions.'}
          </div>
        )}

        {Object.entries(groupedQuestions).map(([subj, list]) => {
          const isExpanded = expandedSubjects.has(subj)
          const filteredQuestions = getFilteredQuestionsForTopic(list, subj)
          const filters = topicFilters[subj] || { difficulty: '', type: '' }

          return (
            <div key={subj} className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleSubject(subj)} className="flex items-center gap-2 hover:bg-gray-50 p-2 rounded-lg transition-colors duration-200">
                      <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                        <ChevronRight className="h-5 w-5 text-gray-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-[#0f2744]">{subj}</h3>
                      <span className="rounded-full bg-[#ff7a59]/10 text-[#ff7a59] px-3 py-1 text-sm font-medium border border-[#ff7a59]/20">
                        {list.length} question{list.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                  </div>
                  <div className="text-sm text-gray-500">
                    {list.filter((q) => q.difficulty === 'Easy').length} Easy •
                    {list.filter((q) => q.difficulty === 'Medium').length} Medium •
                    {list.filter((q) => q.difficulty === 'Hard').length} Hard
                  </div>
                </div>

                {isExpanded && (
                  <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Filter:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={filters.difficulty}
                        onChange={(e) =>
                          setTopicFilters((prev) => ({
                            ...prev,
                            [subj]: { ...(prev[subj] || { difficulty: '', type: '' }), difficulty: e.target.value },
                          }))
                        }
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                      >
                        <option value="">All Difficulties</option>
                        <option value="Very Easy">Very Easy</option>
                        <option value="Easy">Easy</option>
                        <option value="Medium">Medium</option>
                        <option value="Hard">Hard</option>
                        <option value="Very Hard">Very Hard</option>
                      </select>
                      <select
                        value={filters.type}
                        onChange={(e) =>
                          setTopicFilters((prev) => ({
                            ...prev,
                            [subj]: { ...(prev[subj] || { difficulty: '', type: '' }), type: e.target.value },
                          }))
                        }
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                      >
                        <option value="">All Types</option>
                        <option value="MCQ">Multiple Choice</option>
                        <option value="Short Answer">Short Answer</option>
                        <option value="Essay">Essay</option>
                      </select>
                      {(filters.difficulty || filters.type) && (
                        <button
                          onClick={() =>
                            setTopicFilters((prev) => ({
                              ...prev,
                              [subj]: { difficulty: '', type: '' },
                            }))
                          }
                          className="text-sm text-[#ff7a59] hover:text-[#ff6b4a] font-medium"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                    <div className="ml-auto text-sm text-gray-500">
                      Showing {filteredQuestions.length} of {list.length}
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="space-y-3">
                    {filteredQuestions.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">No questions match the selected filters</div>
                    ) : (
                      filteredQuestions.map((q) => (
                        <div key={q.id} className="border border-gray-200 rounded-lg bg-gray-50 p-4 hover:bg-gray-100 transition-colors duration-200">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900 mb-2">{q.text}</p>

                              {q.type === 'MCQ' && q.choices && q.choices.length > 0 && (
                                <div className="mb-3">
                                  <div className="text-sm font-medium text-gray-700 mb-2">Choices:</div>
                                  <div className="space-y-1">
                                    {q.choices.map((choice, index) => (
                                      <div key={index} className="flex items-center gap-2 text-sm">
                                        <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs font-medium text-gray-600">
                                          {String.fromCharCode(65 + index)}
                                        </span>
                                        <span className={`text-gray-700 ${choice === q.answer ? 'font-semibold text-green-700' : ''}`}>
                                          {choice}
                                          {choice === q.answer && (
                                            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Correct Answer</span>
                                          )}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 text-xs">
                                <span className={`rounded px-2 py-0.5 ${difficultyClass(q.difficulty)}`}>{q.difficulty}</span>
                                <span className="rounded px-2 py-0.5 bg-blue-50 text-blue-700">{q.type}</span>
                                {q.tags && q.tags.length > 0 && (
                                  <span className="rounded px-2 py-0.5 bg-gray-200 text-gray-600">
                                    {q.tags.slice(0, 2).join(', ')}
                                    {q.tags.length > 2 ? '...' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => alert(`Answer:\n\n${q.answer}`)}
                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 bg-white"
                              >
                                <Eye className="h-4 w-4" /> View
                              </button>
                              {user?.role !== 'recruiter' && (
                                <button
                                  onClick={async () => {
                                    if (!confirm('Delete this question?')) return
                                    try {
                                      await removeQuestion(q.id)
                                      setQuestions((prev) => prev.filter((x) => x.id !== q.id)) // <- update UI
                                    } catch (e) {
                                      console.error('Delete failed', e)
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 text-rose-700 px-3 py-1.5 text-sm hover:bg-rose-50 bg-white"
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters drawer */}
      {showFilters && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowFilters(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h3 className="font-medium text-[#0f2744]">Refine Results</h3>
              <button onClick={() => setShowFilters(false)} className="rounded-md border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50">
                Close
              </button>
            </div>
            <div className="grid gap-6 p-4">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">Search Questions</div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search question content..."
                    className="w-full rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">Filter by Topic</div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    value={subjectQuery}
                    onChange={(e) => setSubjectQuery(e.target.value)}
                    placeholder="Search topics"
                    className="w-full rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['', ...(showAllSubjects ? filteredSubjects : filteredSubjects.slice(0, 8))].map((s, idx) => {
                    const active = subject === (s as any)
                    const label = s || 'All topics'
                    const count = s ? subjectCounts[s as any] || 0 : questions.length
                    return (
                      <button
                        key={`${label}-${idx}`}
                        onClick={() => setSubject(s as any)}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          active ? 'border-[#ff7a59]/40 bg-[#ff7a59]/10 text-[#0f2744]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {label}{' '}
                        <span className={`ml-1 inline-block rounded-full px-1.5 ${active ? 'bg-[#ff7a59]/20 text-[#0f2744]' : 'bg-gray-100 text-gray-600'}`}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                  {filteredSubjects.length > 8 && (
                    <button
                      onClick={() => setShowAllSubjects((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      {showAllSubjects ? 'Show less' : 'Show more'} {showAllSubjects ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <button onClick={() => setShowFilters(false)} className="w-full rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110">
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
