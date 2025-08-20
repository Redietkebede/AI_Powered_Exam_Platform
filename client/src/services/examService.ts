/**
 * Exam Service - Manages exam attempts, submissions, and completion tracking
 * 
 * NEW FEATURES (One Attempt Per Assignment):
 * - Prevents multiple attempts for the same assignment
 * - Tracks assignment completion status per candidate
 * - Stores completion data with scores and timestamps
 * - Provides completion status checking functions
 * 
 * How it works:
 * 1. When starting an exam, check if assignment already completed
 * 2. If completed, return null (prevents new attempt)
 * 3. If not completed, create new attempt
 * 4. When exam finishes, mark assignment as completed
 * 5. Store completion data for dashboard display
 * 
 * Storage Keys:
 * - ai_exam_results: Legacy aggregated results
 * - ai_exam_attempts: Detailed attempt tracking
 * - ai_exam_assignment_completions: NEW - Assignment completion status
 */

import { getQuestions, type Question } from './questionService'
import { getCurrentUser } from './authService'

type Result = { candidate: string; date: string; correct: number; total: number; score: number }

export type AttemptItem = {
  questionId: string
  subject: string
  difficulty: Question['difficulty']
  type: Question['type']
  correct: boolean
  timeSpentMs: number
  answeredAt: string
}

export type ExamAttempt = {
  attemptId: string
  candidate: string
  startedAt: string
  completedAt: string | null
  items: AttemptItem[]
  assignmentId?: string
}

const RESULT_KEY = 'ai_exam_results'
const ATTEMPT_KEY = 'ai_exam_attempts'
const ASSIGNMENT_COMPLETION_KEY = 'ai_exam_assignment_completions'

function getQuestionPool(): Question[] {
  // only approved questions should be used for delivery
  return getQuestions().filter((q) => q.status === 'approved')
}

export function getAdaptiveNextQuestion(poolArg?: Question[]): Question | null {
  const pool = poolArg && poolArg.length > 0 ? poolArg : getQuestionPool()
  if (pool.length === 0) return null
  // naive adaptive: cycle through difficulties based on random
  const difficultyOrder: Question['difficulty'][] = ['Easy', 'Medium', 'Hard']
  const pick = difficultyOrder[Math.floor(Math.random() * difficultyOrder.length)]
  const filtered = pool.filter((q) => q.difficulty === pick)
  return (filtered[Math.floor(Math.random() * filtered.length)] ?? pool[0])
}

export function submitAnswer(q: Question, ans: { choice?: string; text?: string }): boolean {
  // determine correctness based on actual data
  let correct = false
  if (q.type === 'MCQ' && Array.isArray(q.choices) && ans.choice !== undefined) {
    const idx = Number(ans.choice)
    const selected = isFinite(idx) ? q.choices[idx] : undefined
    if (selected !== undefined) {
      correct = String(selected).trim().toLowerCase() === String(q.answer).trim().toLowerCase()
    }
  } else if (ans.text !== undefined) {
    correct = String(ans.text).trim().toLowerCase() === String(q.answer).trim().toLowerCase()
  }
  const user = getCurrentUser()
  const results = getResults()
  const existing = results.find((r) => r.candidate === (user?.name ?? 'Anonymous'))
  if (!existing) {
    const newEntry: Result = { candidate: user?.name ?? 'Anonymous', date: new Date().toISOString(), correct: Number(correct), total: 1, score: 0 }
    newEntry.score = Math.round((newEntry.correct / newEntry.total) * 100)
    results.push(newEntry)
  } else {
    existing.total += 1
    existing.correct += Number(correct)
    existing.score = Math.round((existing.correct / existing.total) * 100)
    existing.date = new Date().toISOString()
  }
  localStorage.setItem(RESULT_KEY, JSON.stringify(results))
  return correct
}

export function getResults(): Result[] {
  const raw = localStorage.getItem(RESULT_KEY)
  return raw ? (JSON.parse(raw) as Result[]) : []
}

// Attempts API for detailed analytics
export function startAttempt(params?: { assignmentId?: string }): string | null {
  const user = getCurrentUser()
  const candidate = user?.name ?? 'Anonymous'
  
  // If this is an assignment, check if already completed
  if (params?.assignmentId) {
    if (isAssignmentCompleted(params.assignmentId, candidate)) {
      return null // Already completed, prevent new attempt
    }
  }
  
  const attempts = getAttempts()
  const attempt: ExamAttempt = {
    attemptId: crypto.randomUUID(),
    candidate,
    startedAt: new Date().toISOString(),
    completedAt: null,
    items: [],
    assignmentId: params?.assignmentId,
  }
  attempts.push(attempt)
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempts))
  return attempt.attemptId
}

export function endAttempt(attemptId: string) {
  const attempts = getAttempts()
  const attempt = attempts.find(a => a.attemptId === attemptId)
  
  if (attempt) {
    // Mark attempt as completed
    const updatedAttempts = attempts.map((a) => 
      (a.attemptId === attemptId ? { ...a, completedAt: new Date().toISOString() } : a)
    )
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(updatedAttempts))
    
    // If this was an assignment, mark it as completed
    if (attempt.assignmentId) {
      const score = attempt.items.length > 0 
        ? Math.round((attempt.items.filter(item => item.correct).length / attempt.items.length) * 100)
        : 0
      markAssignmentCompleted(attempt.assignmentId, attempt.candidate, attemptId, score)
    }
  }
}

export function submitAnswerWithMetrics(params: { question: Question; answer: { choice?: string; text?: string }; timeSpentMs: number; attemptId: string }): boolean {
  const { question, timeSpentMs, attemptId } = params
  // determine correctness using same logic as submitAnswer
  let isCorrect = false
  if (question.type === 'MCQ' && Array.isArray(question.choices) && params.answer.choice !== undefined) {
    const idx = Number(params.answer.choice)
    const selected = isFinite(idx) ? question.choices[idx] : undefined
    if (selected !== undefined) {
      isCorrect = String(selected).trim().toLowerCase() === String(question.answer).trim().toLowerCase()
    }
  } else if (params.answer.text !== undefined) {
    isCorrect = String(params.answer.text).trim().toLowerCase() === String(question.answer).trim().toLowerCase()
  }

  // keep legacy rollup for backwards compatibility
  submitAnswer(question, params.answer)

  // append to attempt items
  const attempts = getAttempts().map((a) => {
    if (a.attemptId !== attemptId) return a
    const nextItem: AttemptItem = {
      questionId: question.id,
      subject: question.subject,
      difficulty: question.difficulty,
      type: question.type,
      correct: isCorrect,
      timeSpentMs: Math.max(0, Math.floor(timeSpentMs)),
      answeredAt: new Date().toISOString(),
    }
    return { ...a, items: [...a.items, nextItem] }
  })
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempts))
  return isCorrect
}

export function getAttempts(): ExamAttempt[] {
  const raw = localStorage.getItem(ATTEMPT_KEY)
  return raw ? (JSON.parse(raw) as ExamAttempt[]) : []
}

// New: Check if assignment is already completed by user
export function isAssignmentCompleted(assignmentId: string, candidate: string): boolean {
  const completions = getAssignmentCompletions()
  return completions.some(c => c.assignmentId === assignmentId && c.candidate === candidate)
}

// New: Get assignment completion status
export function getAssignmentCompletion(assignmentId: string, candidate: string) {
  const completions = getAssignmentCompletions()
  return completions.find(c => c.assignmentId === assignmentId && c.candidate === candidate)
}

// New: Mark assignment as completed
export function markAssignmentCompleted(assignmentId: string, candidate: string, attemptId: string, score: number) {
  const completions = getAssignmentCompletions()
  const completion = {
    assignmentId,
    candidate,
    attemptId,
    completedAt: new Date().toISOString(),
    score,
    status: 'completed' as const
  }
  completions.push(completion)
  localStorage.setItem(ASSIGNMENT_COMPLETION_KEY, JSON.stringify(completions))
}

// New: Get all assignment completions
export function getAssignmentCompletions() {
  const raw = localStorage.getItem(ASSIGNMENT_COMPLETION_KEY)
  return raw ? (JSON.parse(raw) as Array<{
    assignmentId: string
    candidate: string
    attemptId: string
    completedAt: string
    score: number
    status: 'completed'
  }>) : []
}


