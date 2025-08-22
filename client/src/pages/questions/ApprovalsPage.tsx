import { useMemo, useState, useEffect, useRef } from 'react'
import { getQuestions, updateQuestionStatus } from '../../services/questionService'
import { CheckCircle2, XCircle, Clock, Filter, Search, Eye, EyeOff, CheckSquare, Square, AlertTriangle, Star } from 'lucide-react'

function SelectControl({ value, onChange, options, renderLabel }: { value: string; onChange: (v: string) => void; options: string[]; renderLabel?: (v: string) => string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-slate-800 flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-500"
      >
        <span className="truncate">{renderLabel ? renderLabel(value) : value}</span>
        <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
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
              {renderLabel ? renderLabel(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ApprovalsPage() {
  const [comments, setComments] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'rejected'>('pending')
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [qualityScore, setQualityScore] = useState<Record<string, number>>({})

  const allQuestions = getQuestions()
  
  const items = useMemo(() => {
    return allQuestions.filter((q) => {
      // Status filter
      if (statusFilter === 'all') {
        if (q.status !== 'pending' && q.status !== 'rejected') return false
      } else if (q.status !== statusFilter) return false
      
      // Search filter
      if (searchTerm && !q.text.toLowerCase().includes(searchTerm.toLowerCase()) && 
          !q.answer.toLowerCase().includes(searchTerm.toLowerCase())) return false
      
      // Subject filter
      if (subjectFilter !== 'all' && q.subject !== subjectFilter) return false
      
             // Difficulty filter
       if (difficultyFilter !== 'all' && q.difficulty !== difficultyFilter) return false
       
       // Type filter
       if (typeFilter !== 'all' && q.type !== typeFilter) return false
       
       return true
     })
   }, [statusFilter, searchTerm, subjectFilter, difficultyFilter, typeFilter])

  const subjects = useMemo(() => {
    const uniqueSubjects = [...new Set(allQuestions.map(q => q.subject))]
    return uniqueSubjects.sort()
  }, [allQuestions])

  const handleBulkAction = (action: 'approve' | 'reject') => {
    const comment = action === 'approve' ? 'Bulk approved' : 'Bulk rejected'
    selectedQuestions.forEach(questionId => {
      updateQuestionStatus(questionId, action === 'approve' ? 'approved' : 'rejected', { comment })
    })
    setSelectedQuestions(new Set())
  }

  const toggleQuestionSelection = (questionId: string) => {
    const newSelected = new Set(selectedQuestions)
    if (newSelected.has(questionId)) {
      newSelected.delete(questionId)
    } else {
      newSelected.add(questionId)
    }
    setSelectedQuestions(newSelected)
  }

  const toggleAllQuestions = () => {
    if (selectedQuestions.size === items.length) {
      setSelectedQuestions(new Set())
    } else {
      setSelectedQuestions(new Set(items.map(q => q.id)))
    }
  }

  const getQualityIndicator = (question: any) => {
    const score = qualityScore[question.id] || 0
    if (score >= 8) return { icon: Star, color: 'text-yellow-500', label: 'High Quality' }
    if (score >= 6) return { icon: CheckCircle2, color: 'text-green-500', label: 'Good Quality' }
    if (score >= 4) return { icon: AlertTriangle, color: 'text-orange-500', label: 'Needs Review' }
    return { icon: XCircle, color: 'text-red-500', label: 'Poor Quality' }
  }

  const pendingCount = allQuestions.filter(q => q.status === 'pending').length
  const rejectedCount = allQuestions.filter(q => q.status === 'rejected').length

  return (
    <div className="space-y-6">
      {/* Header with Quality Assurance Focus */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff7a59] to-[#ff6b4a] text-white shadow-sm">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0f2744]">Question Approvals</h1>
              <p className="text-sm text-gray-600 mt-1">Review and approve high-quality exam content. Ensure relevance and accuracy.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 border border-amber-200">
              <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></div>
              <span className="text-sm font-medium text-amber-700">{pendingCount} pending</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 border border-red-200">
              <div className="h-2 w-2 rounded-full bg-red-500"></div>
              <span className="text-sm font-medium text-red-700">{rejectedCount} rejected</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search questions and answers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-gray-300 pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-500 transition-all duration-200"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200 ${
                showFilters 
                  ? 'border-[#ff7a59] bg-[#ff7a59]/10 text-[#ff7a59]' 
                  : 'border-gray-300 text-gray-700 hover:border-[#ff7a59] hover:bg-[#ff7a59]/5'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filters
              {showFilters ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          
          {/* Status Filter Tabs */}
          <div className="flex gap-2">
            {([
              { v: 'pending', label: 'Pending', count: pendingCount },
              { v: 'rejected', label: 'Rejected', count: rejectedCount },
              { v: 'all', label: 'All', count: pendingCount + rejectedCount },
            ] as const).map((b) => {
              const active = statusFilter === b.v
              return (
                <button
                  key={b.v}
                  onClick={() => setStatusFilter(b.v)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200 ${
                    active 
                      ? 'border-[#ff7a59] bg-[#ff7a59]/10 text-[#ff7a59] shadow-sm' 
                      : 'border-gray-200 text-gray-700 hover:border-[#ff7a59] hover:bg-[#ff7a59]/5'
                  }`}
                >
                  {b.label}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    active ? 'bg-[#ff7a59] text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {b.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

                 {/* Advanced Filters */}
         {showFilters && (
           <div className="mt-6 grid gap-6 border-t border-gray-200 pt-6 sm:grid-cols-2 lg:grid-cols-3">
             <div>
               <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
               <SelectControl
                 value={subjectFilter}
                 onChange={(v) => setSubjectFilter(v)}
                 options={[ 'all', ...subjects ]}
                 renderLabel={(v) => v === 'all' ? 'All Subjects' : v}
               />
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 mb-2">Difficulty</label>
               <SelectControl
                 value={difficultyFilter}
                 onChange={(v) => setDifficultyFilter(v)}
                 options={[ 'all', 'Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard' ]}
                 renderLabel={(v) => v === 'all' ? 'All Difficulties' : v}
               />
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 mb-2">Question Type</label>
               <SelectControl
                 value={typeFilter}
                 onChange={(v) => setTypeFilter(v)}
                 options={[ 'all', 'MCQ', 'Short Answer', 'Essay' ]}
                 renderLabel={(v) => v === 'all' ? 'All Types' : v}
               />
             </div>
           </div>
         )}
      </div>

      {/* Bulk Actions */}
      {selectedQuestions.size > 0 && (
        <div className="rounded-xl border border-[#ff7a59]/20 bg-gradient-to-r from-[#ff7a59]/5 to-[#ff7a59]/10 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-[#ff7a59]/20 px-3 py-2">
                <CheckSquare className="h-4 w-4 text-[#ff7a59]" />
                <span className="text-sm font-semibold text-[#0f2744]">
                  {selectedQuestions.size} question(s) selected
                </span>
              </div>
              <button
                onClick={toggleAllQuestions}
                className="text-sm font-medium text-[#ff7a59] hover:text-[#ff6b4a] transition-colors duration-200"
              >
                {selectedQuestions.size === items.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleBulkAction('approve')}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-medium text-white hover:from-emerald-600 hover:to-emerald-700 shadow-sm transition-all duration-200"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve All
              </button>
              <button
                onClick={() => handleBulkAction('reject')}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-4 py-2 text-sm font-medium text-white hover:from-rose-600 hover:to-rose-700 shadow-sm transition-all duration-200"
              >
                <XCircle className="h-4 w-4" />
                Reject All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions List */}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-6">
            <Clock className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No questions awaiting review</h3>
          <p className="text-gray-500 max-w-md mx-auto">All questions have been processed or no questions match your current filters. Try adjusting your search criteria.</p>
        </div>
      )}

      <div className="grid gap-6">
        {items.map((q) => {
          const qualityIndicator = getQualityIndicator(q)
          const QualityIcon = qualityIndicator.icon
          const isSelected = selectedQuestions.has(q.id)
          
          return (
            <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  {/* Question Header */}
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => toggleQuestionSelection(q.id)}
                      className={`mt-1 p-1 rounded-lg transition-all duration-200 ${
                        isSelected 
                          ? 'text-[#ff7a59] bg-[#ff7a59]/10' 
                          : 'text-gray-400 hover:text-[#ff7a59] hover:bg-[#ff7a59]/5'
                      }`}
                    >
                      {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-900 leading-relaxed">{q.text}</h3>
                        <div className="flex items-center gap-2 ml-6">
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${qualityIndicator.color.replace('text-', 'bg-').replace('500', '50')} ${qualityIndicator.color} border-current/20`}>
                            <QualityIcon className="h-4 w-4" />
                            <span className="text-xs font-semibold">{qualityIndicator.label}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <p className="text-sm text-gray-700 font-medium">Answer: <span className="font-normal">{q.answer}</span></p>
                      </div>
                      
                      {/* Metadata */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="rounded-lg bg-[#0f2744]/10 text-[#0f2744] px-3 py-1.5 text-xs font-medium border border-[#0f2744]/20">{q.subject}</span>
                        <span className="rounded-lg bg-[#0f2744]/10 text-[#0f2744] px-3 py-1.5 text-xs font-medium border border-[#0f2744]/20">{q.difficulty}</span>
                        <span className="rounded-lg bg-[#0f2744]/10 text-[#0f2744] px-3 py-1.5 text-xs font-medium border border-[#0f2744]/20">{q.type}</span>
                        <span className="rounded-lg bg-[#0f2744]/10 text-[#0f2744] px-3 py-1.5 text-xs font-medium border border-[#0f2744]/20">
                          {q.status}
                        </span>
                        {q.tags && q.tags.length > 0 && (
                          <span className="rounded-lg bg-[#0f2744]/10 text-[#0f2744] px-3 py-1.5 text-xs font-medium border border-[#0f2744]/20">
                            {q.tags.length} tag{q.tags.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Quality Score */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-3">Quality Score (1-10)</label>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={qualityScore[q.id] || 5}
                            onChange={(e) => setQualityScore(prev => ({ ...prev, [q.id]: Number(e.target.value) }))}
                            className="w-full accent-[#ff7a59] h-2 rounded-lg appearance-none cursor-pointer"
                          />
                          <div className="flex justify-between text-xs text-gray-500 mt-2">
                            <span className="font-medium">Poor</span>
                            <span className="font-bold text-[#ff7a59]">{qualityScore[q.id] || 5}/10</span>
                            <span className="font-medium">Excellent</span>
                          </div>
                        </div>
                      </div>

                      {/* History */}
                      {q.history && q.history.length > 0 && (
                        <div className="mb-4">
                          <div className="text-sm font-semibold text-gray-700 mb-3">Review History</div>
                          <div className="space-y-2">
                            {q.history.slice(-3).reverse().map((h, idx) => (
                              <div key={idx} className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-900">{h.by}</span>
                                  <span className="text-xs text-gray-500">{new Date(h.at).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-600">{h.from}</span>
                                  <span className="text-xs text-gray-400">→</span>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                    h.to === 'approved' ? 'bg-[#0f2744]/10 text-[#0f2744] border border-[#0f2744]/20' : 
                                    h.to === 'rejected' ? 'bg-[#0f2744]/10 text-[#0f2744] border border-[#0f2744]/20' : 
                                    'bg-[#0f2744]/10 text-[#0f2744] border border-[#0f2744]/20'
                                  }`}>
                                    {h.to}
                                  </span>
                                </div>
                                {h.comment && (
                                  <p className="text-xs text-gray-600 mt-2 italic">"{h.comment}"</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Panel */}
                <div className="flex flex-col items-end gap-4">
                  <div className="w-72">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Reviewer Comment</label>
                    <textarea
                      placeholder="Add your review comment (optional)..."
                      value={comments[q.id] ?? ''}
                      onChange={(e) => setComments((m) => ({ ...m, [q.id]: e.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-[#ff7a59] focus:ring-2 focus:ring-[#ff7a59]/20 transition-all duration-200 resize-none"
                      rows={4}
                    />
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => updateQuestionStatus(q.id, 'approved', { 
                        comment: comments[q.id],
                        reviewer: 'Current Editor'
                      })} 
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3 text-sm font-medium text-white hover:from-emerald-600 hover:to-emerald-700 shadow-sm transition-all duration-200"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </button>
                    <button 
                      onClick={() => updateQuestionStatus(q.id, 'rejected', { 
                        comment: comments[q.id],
                        reviewer: 'Current Editor'
                      })} 
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-6 py-3 text-sm font-medium text-white hover:from-rose-600 hover:to-rose-700 shadow-sm transition-all duration-200"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}




