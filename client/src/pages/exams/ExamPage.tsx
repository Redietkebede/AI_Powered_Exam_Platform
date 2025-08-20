import { useEffect, useRef, useState } from 'react'
import { getAdaptiveNextQuestion, submitAnswerWithMetrics, startAttempt, endAttempt, isAssignmentCompleted, getAssignmentCompletion } from '../../services/examService'
import type { Question } from '../../services/questionService'
import { getQuestions } from '../../services/questionService'
import { getCurrentUser } from '../../services/authService'

type Answer = { choiceIndex?: number; text?: string }

export default function ExamPage() {
  const [question, setQuestion] = useState<Question | null>(null)
  const [progress, setProgress] = useState({ index: 0, total: 10, correct: 0 })
  const [timer, setTimer] = useState(60)
  const [perQuestionSeconds, setPerQuestionSeconds] = useState(60)
  const timerRef = useRef<number | null>(null)
  const [answer, setAnswer] = useState<Answer>({})
  const [finished, setFinished] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const questionStartRef = useRef<number | null>(null)
  const [pool, setPool] = useState<Question[]>([])
  const autoSubmittedRef = useRef(false)
  const [emptyPool, setEmptyPool] = useState(false)
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)
  const [completionData, setCompletionData] = useState<any>(null)
  
  // Track previous questions and answers for back navigation
  const [questionHistory, setQuestionHistory] = useState<Array<{
    question: Question
    answer: Answer
    timeSpentMs: number
  }>>([])

  useEffect(() => {
    // Read assignment context from URL (?assignmentId=...)
    const params = new URLSearchParams(window.location.search)
    const aid = params.get('assignmentId')

    // If assignmentId exists, check if already completed
    if (aid) {
      const user = getCurrentUser()
      const candidate = user?.name ?? 'Anonymous'
      
      if (isAssignmentCompleted(aid, candidate)) {
        // Assignment already completed - show completion summary
        setAlreadyCompleted(true)
        const completion = getAssignmentCompletion(aid, candidate)
        setCompletionData(completion)
        return
      }
    }

    // Build delivery pool (temporarily restrict to MCQ for "choose questions")
    const bank = getQuestions().filter((q) => q.status === 'approved')
    // If assignmentId exists, try to load stored assignment
    const raw = localStorage.getItem('ai_exam_assignments_v2')
    let delivery = bank
    let configuredPerQuestion = 60
    if (aid && raw) {
      try {
        const list: any[] = JSON.parse(raw)
        const a = list.find((x) => x.id === aid)
        if (a) {
          const ids: string[] = a.questionIds || []
          if (ids.length > 0) delivery = bank.filter((q) => ids.includes(q.id))
          // optional: override timer from config if provided
          if (typeof a?.config?.timeLimitMinutes === 'number' && a.config.timeLimitMinutes > 0) {
            configuredPerQuestion = Math.round(a.config.timeLimitMinutes * 60)
          }
          // set total count to assignment size
          if (Array.isArray(ids) && ids.length > 0) setProgress((p) => ({ ...p, total: Math.min(ids.length, p.total) }))
        }
      } catch {}
    }
    // Restrict to MCQ for now
    const mcqOnly = delivery.filter((q) => q.type === 'MCQ')
    if (mcqOnly.length === 0) {
      setEmptyPool(true)
      return
    }
    setPool(mcqOnly)
    // Align total with available pool (respect existing cap of 10 by default)
    setProgress((p) => ({ ...p, total: Math.min(mcqOnly.length, p.total) }))
    
    // Try to start attempt - this will return null if already completed
    const id = startAttempt(aid ? { assignmentId: aid } : undefined)
    if (!id) {
      // This shouldn't happen since we checked above, but handle gracefully
      setAlreadyCompleted(true)
      return
    }
    
    setAttemptId(id)
    const q = getAdaptiveNextQuestion(mcqOnly as any)
    setQuestion(q)
    questionStartRef.current = performance.now()
    // apply per-question timer
    setPerQuestionSeconds(configuredPerQuestion)
    setTimer(configuredPerQuestion)
  }, [])

  useEffect(() => {
    if (finished) return
    timerRef.current = window.setInterval(() => setTimer((t) => (t > 0 ? t - 1 : 0)), 1000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [finished])

  // Auto-advance when timer hits 0 (once per question)
  useEffect(() => {
    if (finished) return
    if (timer === 0 && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true
      handleSubmit()
    }
  }, [timer, finished])

  // Reset auto-submit guard as soon as a new timer (>0) is active
  useEffect(() => {
    if (timer > 0) {
      autoSubmittedRef.current = false
    }
  }, [timer])

  function handleSubmit() {
    if (!question) return
    const startedAt = questionStartRef.current ?? performance.now()
    const timeSpentMs = performance.now() - startedAt
    const normalizedAnswer = answer.choiceIndex !== undefined ? { choice: String(answer.choiceIndex), text: undefined } : { text: answer.text }
    const correct = submitAnswerWithMetrics({ question, answer: normalizedAnswer, timeSpentMs, attemptId: attemptId ?? '' })
    
    // Add current question to history
    setQuestionHistory(prev => [...prev, { question, answer, timeSpentMs }])
    
    setProgress((p) => ({ index: p.index + 1, total: p.total, correct: p.correct + (correct ? 1 : 0) }))
    if (progress.index + 1 >= progress.total) {
      setFinished(true)
      if (attemptId) endAttempt(attemptId)
      return
    }
    setTimer(perQuestionSeconds)
    setAnswer({})
    const next = getAdaptiveNextQuestion(pool as any)
    setQuestion(next)
    questionStartRef.current = performance.now()
  }

  function handleBack() {
    if (questionHistory.length === 0) return
    
    // Get the last question from history
    const lastQuestion = questionHistory[questionHistory.length - 1]
    
    // Remove the last question from history
    setQuestionHistory(prev => prev.slice(0, -1))
    
    // Go back to previous question
    setQuestion(lastQuestion.question)
    setAnswer(lastQuestion.answer)
    setProgress(p => ({ ...p, index: p.index - 1 }))
    setTimer(perQuestionSeconds) // Reset timer for the question
    questionStartRef.current = performance.now()
  }

  if (alreadyCompleted) {
    const score = Math.round((completionData?.correct / completionData?.total) * 100)
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/30 p-8 max-w-sm w-full">
          <div className="text-center">
            {/* Completion Icon */}
            <div className="w-16 h-16 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            
            {/* Header */}
            <h1 className="text-xl font-bold text-slate-800 mb-3">Exam Completed!</h1>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">You have already completed this exam.</p>
            
            {/* Completion Details */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/50 mb-6">
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide font-medium">Your Score</p>
              <p className="text-2xl font-bold text-slate-800 mb-1">{score}%</p>
              <p className="text-xs text-slate-500">{completionData?.correct} of {completionData?.total} correct</p>
            </div>
            
            {/* Action Button */}
            <button 
              onClick={() => window.location.href = '/app/dashboard'}
              className="w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-4 py-3 rounded-xl font-medium hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-200 hover:shadow-lg shadow-md"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (finished) {
    const score = Math.round((progress.correct / progress.total) * 100)
    
    if (!showResults) {
      // Completion Card - No results shown yet
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/30 p-8 max-w-sm w-full">
            <div className="text-center">
              {/* Success Icon */}
              <div className="w-16 h-16 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              
              {/* Header */}
              <h1 className="text-xl font-bold text-slate-800 mb-3">Exam Completed!</h1>
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">Great job! You've finished the exam successfully.</p>
              
              {/* Action Buttons */}
              <div className="space-y-3">
                <button 
                  onClick={() => setShowResults(true)}
                  className="w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-4 py-3 rounded-xl font-medium hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-200 hover:shadow-lg shadow-md"
                >
                  View Results
                </button>
                <button 
                  onClick={() => window.location.href = '/app/dashboard'}
                  className="w-full bg-slate-100 text-slate-600 px-4 py-3 rounded-xl font-medium hover:bg-slate-200 transition-all duration-200 border border-slate-200"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    } else {
      // Results Screen - After clicking "View Score"
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/30 p-8 max-w-sm w-full">
            <div className="text-center">
              {/* Results Icon */}
              <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2zm0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              
              {/* Header */}
              <h1 className="text-xl font-bold text-slate-800 mb-5">Your Results</h1>
              
              {/* Score Display */}
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-5 border border-slate-200/50 mb-5">
                <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide font-medium">Final Score</p>
                <p className="text-2xl font-bold text-slate-800 mb-1">{score}%</p>
                <p className="text-xs text-slate-500">{progress.correct} of {progress.total} correct</p>
              </div>
              
              {/* Performance Summary */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/50 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">Questions</p>
                    <p className="text-lg font-semibold text-slate-700">{progress.total}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">Correct</p>
                    <p className="text-lg font-semibold text-slate-700">{progress.correct}</p>
                  </div>
                </div>
              </div>
              
              {/* Action Button */}
              <button 
                onClick={() => window.location.href = '/app/dashboard'}
                className="w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-4 py-3 rounded-xl font-medium hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-200 hover:shadow-lg shadow-md"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 p-4">
      <div className="max-w-4xl mx-auto">
        {emptyPool && (
          <div className="bg-white border border-amber-200 text-amber-800 rounded-xl p-4 mb-4">
            No approved MCQ questions found in the Question Bank. Please add approved MCQs to start the exam.
          </div>
        )}
                 {/* Header */}
         <div className="bg-gradient-to-br from-white via-slate-50 to-slate-100 rounded-3xl shadow-lg border border-slate-200/50 p-5 sm:p-6 mb-5 sm:mb-6">
           <div className="flex items-center justify-between gap-3">
             <div className="flex items-center">
               <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-2xl flex items-center justify-center mr-3 sm:mr-4 shadow-lg">
                 <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
               </div>
               <div>
                 <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Exam Session</h1>
                 <p className="text-slate-600 text-xs sm:text-sm">Question {progress.index + 1} of {progress.total}</p>
               </div>
             </div>
             
             {/* Timer */}
             <div className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-semibold text-base sm:text-lg transition-all duration-300 ${
               timer <= 10 
                 ? 'bg-gradient-to-r from-red-100 to-red-200 text-red-700 border border-red-300' 
                 : timer <= 30
                 ? 'bg-gradient-to-r from-orange-100 to-orange-200 text-orange-700 border border-orange-300'
                 : 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border border-slate-300'
             }`}>
               <div className="flex items-center">
                 <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
                 {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
               </div>
             </div>
           </div>
         </div>

        {/* Question Card */}
        <div className="bg-gradient-to-br from-white to-slate-50/50 rounded-3xl shadow-lg border border-slate-200/50 p-6 sm:p-8">
          {question ? (
            <>
              {/* Question Header */}
              <div className="mb-5 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-slate-800 leading-relaxed">{question.text}</h2>
              </div>

              {/* Answer Options */}
              {question.type === 'MCQ' && (
                <div className="space-y-3 mb-6 sm:mb-8">
                  {(question.choices ?? ['Option 1','Option 2','Option 3','Option 4']).map((label, idx) => (
                    <label key={idx} className={`group cursor-pointer block transition-all duration-300 ${
                      answer.choiceIndex === idx 
                        ? 'bg-gradient-to-r from-slate-100 to-slate-200 border-slate-300' 
                        : 'bg-gradient-to-r from-slate-50 to-slate-100/50 border-slate-200/50 hover:from-slate-100 hover:to-slate-200/50'
                    } border-2 rounded-xl p-4 hover:shadow-md hover:scale-[1.01]`}>
                      <div className="flex items-center">
                        <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center mr-3 sm:mr-4 transition-all duration-300 ${
                          answer.choiceIndex === idx 
                            ? 'border-slate-600 bg-slate-600' 
                            : 'border-slate-300 group-hover:border-slate-400'
                        }`}>
                          {answer.choiceIndex === idx && (
                            <div className="w-2 h-2 bg-white rounded-full"></div>
                          )}
                        </div>
                        <input
                          type="radio"
                          name="mcq"
                          checked={answer.choiceIndex === idx}
                          onChange={() => setAnswer({ choiceIndex: idx })}
                          className="sr-only"
                        />
                        <span className="text-slate-800 text-sm sm:text-base font-medium">{label}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Text Answer */}
              {question.type !== 'MCQ' && (
                <div className="mb-6 sm:mb-8">
                  <textarea
                    value={answer.text ?? ''}
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
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 hover:from-slate-200 hover:to-slate-300 hover:scale-[1.02] shadow-md border border-slate-300/50'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Previous</span>
                  </button>
                  <div className="flex items-center text-xs sm:text-sm text-slate-600 bg-gradient-to-r from-slate-50 to-slate-100/50 px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200/50">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-2 text-[#ff7a59]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Adaptive Mode
                  </div>
                </div>
                <button 
                  onClick={handleSubmit} 
                  className="bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold hover:from-slate-700 hover:to-slate-800 transition-all duration-300 hover:shadow-lg border border-[#ff7a59] shadow-md hover:scale-[1.02] flex items-center justify-center space-x-2"
                >
                  <span>{progress.index + 1 >= progress.total ? 'Finish Exam' : 'Submit & Next'}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-slate-600 text-lg font-medium">Loading next question...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


