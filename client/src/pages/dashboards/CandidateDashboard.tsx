import { Link } from 'react-router-dom'
import { getAttempts, isAssignmentCompleted, getAssignmentCompletion, getAssignmentCompletions } from '../../services/examService'
import { useMemo, useState, useEffect } from 'react'
import { getCurrentUser } from '../../services/authService'
import { type User } from '../../services/userService';

// local helper to read saved assignments created in AssignmentsPage
function getAssignmentsLocal() {
	try {
		const raw = localStorage.getItem('ai_exam_assignments_v2')
		return raw ? (JSON.parse(raw) as any[]) : []
	} catch {
		return []
	}
}

export default function CandidateDashboard() {
  const [showGuidelinesModal, setShowGuidelinesModal] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null);
  
  useEffect(() => {
    const fetchUser = async () => {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    };
    fetchUser();
  }, []);

  const allAttempts = getAttempts()
  const candidateAttempts = useMemo(() => {
    return allAttempts.filter((a) => a.candidate === (user?.name ?? ''))
  }, [allAttempts, user])
  
  // Calculate candidate statistics
  const stats = useMemo(() => {
    // Get assignment completions for the current user
    const assignmentCompletions = getAssignmentCompletions().filter(c => c.candidate === user?.name)
    
    // Combine old attempts with new assignment completions
    const allCompletions = [
      ...candidateAttempts.map(attempt => ({
        score: Math.round((attempt.items.filter(i => i.correct).length / attempt.items.length) * 100),
        questions: attempt.items.length,
        correct: attempt.items.filter(i => i.correct).length,
        isAssignment: false
      })),
      ...assignmentCompletions.map(completion => ({
        score: completion.score,
        questions: 0, // We don't store question count in completion data
        correct: 0,   // We don't store correct count in completion data
        isAssignment: true
      }))
    ]
    
    const totalAttempts = allCompletions.length
    const avgScore = totalAttempts > 0 
      ? Math.round(allCompletions.reduce((sum, c) => sum + c.score, 0) / totalAttempts)
      : 0
    
    // For questions and accuracy, we can only use data from attempts (not assignments)
    const attemptCompletions = allCompletions.filter(c => !c.isAssignment)
    const totalQuestions = attemptCompletions.reduce((sum, c) => sum + c.questions, 0)
    const correctAnswers = attemptCompletions.reduce((sum, c) => sum + c.correct, 0)
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0
    
    return {
      totalAttempts,
      avgScore,
      totalQuestions,
      correctAnswers,
      accuracy
    }
  }, [candidateAttempts, user?.name])

  // Get recent attempts and completions
  const recentAttempts = useMemo(() => {
    // Get assignment completions for the current user
    const assignmentCompletions = getAssignmentCompletions().filter(c => c.candidate === user?.name)
    
    // Combine attempts with assignment completions
    const allRecent = [
      ...candidateAttempts.map(attempt => ({
        type: 'attempt' as const,
        id: attempt.attemptId,
        date: attempt.startedAt,
        score: Math.round((attempt.items.filter(i => i.correct).length / attempt.items.length) * 100),
        questions: attempt.items.length,
        correct: attempt.items.filter(i => i.correct).length
      })),
      ...assignmentCompletions.map(completion => ({
        type: 'assignment' as const,
        id: completion.assignmentId,
        date: completion.completedAt,
        score: completion.score,
        questions: 0,
        correct: 0
      }))
    ]
    
    return allRecent
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
  }, [candidateAttempts, user?.name])

  // Get assigned exams dynamically for the current candidate
  const assignedExams = useMemo(() => {
    const all = getAssignmentsLocal()
    if (!user) return [] as any[]
    const mine = all.filter((a) => Array.isArray(a.candidateIds) && a.candidateIds.includes(user.id))
    // map to card shape with dynamic title/desc/due/duration/questionCount/topics/guidelines
    return mine.map((a) => {
      const topics: string[] = Array.isArray(a?.config?.topics) && a.config.topics.length > 0 ? a.config.topics : ['General']
      const dueDate = a?.schedule?.dueAt || a?.schedule?.due || a?.dueDate || ''
      const duration = typeof a?.config?.timeLimitMinutes === 'number' ? a.config.timeLimitMinutes : 60
      const count = Array.isArray(a?.questionIds) ? a.questionIds.length : (typeof a?.config?.questionCount === 'number' ? a.config.questionCount : 10)
      const adaptive = !!a?.config?.adaptive
      const typeList = Array.isArray(a?.config?.allowedTypes) ? a.config.allowedTypes : []
      const totalMinutes = Math.round(duration * count)
      
      // Check if this assignment is completed
      const isCompleted = isAssignmentCompleted(a.id, user.name ?? '')
      const completionData = isCompleted ? getAssignmentCompletion(a.id, user.name ?? '') : null
      const status = isCompleted ? 'completed' : 'pending'
      
      const guidelines = [
        `You have ${totalMinutes} minutes to complete the exam`,
        adaptive ? 'This exam uses adaptive questioning based on your performance' : 'Questions are presented in a fixed order',
        topics.length > 0 ? `Covered topics: ${topics.join(', ')}` : 'Covered topics: General',
        typeList.length > 0 ? `Question types: ${typeList.join(', ')}` : 'Question types: multiple formats',
        'Ensure a stable internet connection and avoid refreshing the page',
        '⚠️ IMPORTANT: Only ONE attempt is allowed per exam - make sure you are ready before starting!'
      ]
      const titleBase = topics.length === 0
        ? 'Assessment'
        : topics.length === 1
          ? `${topics[0]} Assessment`
          : `${topics[0]} +${topics.length - 1} Assessment`
      const description = topics.length > 0 ? topics.join(', ') : 'General'
      return {
        id: a.id,
        title: titleBase,
        description,
        dueDate,
        duration: totalMinutes,
        questionCount: count,
        status,
        topics,
        guidelines,
        isCompleted,
        completionData,
      }
    })
  }, [user])

  const completedExams = useMemo(() => {
    return candidateAttempts.filter(a => !!a.completedAt)
  }, [candidateAttempts])

  const openGuidelines = (examId: string) => {
    setShowGuidelinesModal(examId)
  }

  const closeGuidelines = () => {
    setShowGuidelinesModal(null)
  }

  const getCurrentExam = () => {
    return assignedExams.find((exam: any) => exam.id === showGuidelinesModal)
  }

  

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 bg-gradient-to-br from-slate-50 via-white to-slate-50 min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <div className="flex items-center">
          <div className="w-12 h-12 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-4 hover:scale-105 transition-all duration-300 shadow-md">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 mb-2 sm:mb-3">Welcome Back!</h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed">Ready for your next assessment? Let's get started with confidence.</p>
          </div>
        </div>
      </div>

      {/* Assigned Exams */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
          <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          Your Assigned Exams
        </h2>
        
        {assignedExams.length > 0 ? (
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {assignedExams.map((exam) => (
              <div key={exam.id} className="bg-gradient-to-br from-white via-slate-100/30 to-slate-200/20 rounded-2xl p-6 border border-slate-300/30 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 hover:border-slate-400/50 group shadow-lg">
                <div className="flex items-center justify-between mb-5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-all duration-300 shadow-md ${
                    exam.isCompleted 
                      ? 'bg-gradient-to-br from-green-500 to-green-600 group-hover:from-green-600 group-hover:to-green-700' 
                      : 'bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] group-hover:from-[#ff7a59] group-hover:to-[#ff7a59]'
                  }`}>
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {exam.isCompleted ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      )}
                    </svg>
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-[#ff7a59] bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full group-hover:from-slate-200 group-hover:to-slate-300 transition-all duration-300 border border-slate-300 shadow-md">
                    {exam.isCompleted ? 'Completed' : `Due: ${new Date(exam.dueDate).toLocaleDateString()}`}
                  </span>
                </div>
                <h3 className="font-bold text-slate-800 text-lg sm:text-xl mb-2 sm:mb-3 leading-tight">{exam.title}</h3>
                <p className="text-slate-600 text-sm sm:text-base mb-3 sm:mb-4 leading-relaxed">{exam.description}</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {exam.topics.map((topic: string, index: number) => (
                    <span key={index} className="text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full border shadow-md font-medium bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300 hover:from-slate-200 hover:to-slate-300 transition-all duration-300">
                      {topic}
                    </span>
                  ))}
                </div>
                
                {exam.isCompleted ? (
                  <div className="space-y-3">
                    {/* Completion Status */}
                    <div className="flex items-center justify-center p-2 bg-gradient-to-r from-green-100 to-green-200 rounded-lg border border-green-300">
                      <svg className="w-4 h-4 text-green-700 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm font-semibold text-green-700">Completed</span>
                    </div>
                    
                    {/* Score Display */}
                    <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-lg font-bold text-slate-800">{exam.completionData?.score || 0}%</div>
                      <div className="text-xs text-slate-600">Final Score</div>
                    </div>
                    
                    {/* View Results Button */}
                    <Link 
                      to={`/app/exam?assignmentId=${exam.id}`}
                      className="inline-flex items-center justify-center w-full bg-gradient-to-r from-slate-600 to-slate-700 text-white px-5 py-3 rounded-xl text-sm sm:text-base font-semibold hover:from-slate-700 hover:to-slate-800 transition-all duration-300 hover:shadow-lg border border-slate-600 shadow-md hover:scale-105"
                    >
                      View Results
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Start Exam Button */}
                    <Link 
                      to={`/app/exam?assignmentId=${exam.id}`}
                      className="inline-flex items-center justify-center w-full bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 py-3 rounded-xl text-sm sm:text-base font-semibold hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-300 hover:shadow-lg border border-[#ff7a59] shadow-md hover:scale-105"
                    >
                      Start Exam
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </Link>
                    
                    {/* Guidelines Button */}
                    <button 
                      onClick={() => openGuidelines(exam.id)}
                      className="inline-flex items-center justify-center w-full bg-slate-100 text-slate-700 px-5 py-3 rounded-xl text-sm sm:text-base font-semibold hover:bg-slate-200 transition-all duration-300 border border-slate-300 shadow-md"
                    >
                      View Guidelines
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-3">No assigned exams at the moment</h3>
            <p className="text-slate-600 text-base leading-relaxed">Your recruiter will assign exams for you to complete. Check back soon!</p>
          </div>
        )}
      </div>

      {/* Quick Actions & Performance Overview */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Actions */}
        <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl flex items-center justify-center mr-3 sm:mr-4 shadow-lg">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            Quick Actions
          </h2>
          
          <div className="space-y-3">
            <Link 
              to="/app/results" 
              className="flex items-center p-4 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-xl hover:scale-[1.02] transition-all duration-300 group border border-slate-300/40"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 group-hover:scale-110 transition-all duration-300 shadow-md">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2zm0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-sm sm:text-base mb-1 transition-colors">View My Results</h3>
                <p className="text-xs sm:text-sm text-slate-600 transition-colors">Review your performance and see detailed insights.</p>
              </div>
              <svg className="w-5 h-5 text-slate-700 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            <div className="flex items-center p-4 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-xl hover:scale-[1.02] transition-all duration-300 border border-slate-300/40">
              <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800 text-sm sm:text-base mb-1 group-hover:text-white transition-colors">Completed Exams</h3>
                <p className="text-xs sm:text-sm text-slate-600 group-hover:text-slate-200 transition-colors">Review your completed assessments.</p>
              </div>
              <div className="text-right">
                <div className="text-lg sm:text-2xl font-bold text-slate-700">{completedExams.length}</div>
                <div className="text-xs sm:text-sm text-slate-700 font-medium">Completed</div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Overview */}
        <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2z" />
              </svg>
            </div>
            Performance Overview
          </h2>
          
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">{stats.totalAttempts}</div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">Total Attempts</div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-200/40 to-slate-300/30 rounded-2xl border border-slate-400/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">{stats.avgScore}%</div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">Average Score</div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">{stats.correctAnswers}/{stats.totalQuestions}</div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">Correct/Total</div>
            </div>
            <div className="text-center p-5 sm:p-6 bg-gradient-to-br from-slate-200/40 to-slate-300/30 rounded-2xl border border-slate-400/30 hover:shadow-xl hover:scale-110 transition-all duration-500 shadow-lg">
              <div className="text-2xl sm:text-3xl font-bold text-[#ff7a59] mb-2 sm:mb-3">{stats.accuracy}%</div>
              <div className="text-sm sm:text-base font-semibold text-slate-800">Overall Accuracy</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-gradient-to-br from-white via-slate-100/50 to-slate-200/30 rounded-3xl shadow-lg border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-500">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
          <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 shadow-md">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          Recent Activity
        </h2>
        
        {recentAttempts.length > 0 ? (
          <div className="space-y-3">
            {recentAttempts.map((item, index) => {
              return (
                <div key={item.id} className="flex items-center justify-between p-4 sm:p-5 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-2xl border border-slate-300/30 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 hover:border-slate-400/50 shadow-lg">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center mr-3 hover:scale-110 transition-transform duration-200 shadow-md">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800 text-sm sm:text-lg">
                        {item.type === 'assignment' ? 'Assignment Completed' : `Exam Attempt #${index + 1}`}
                      </div>
                      <div className="text-slate-600 text-xs sm:text-sm">{new Date(item.date).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-lg sm:text-xl ${item.score >= 70 ? 'text-[#ff7a59]' : item.score >= 50 ? 'text-[#ff7a59]' : 'text-[#ff7a59]'}`}>
                      {item.score}%
                    </div>
                    <div className="text-xs sm:text-sm text-slate-600">
                      {item.type === 'assignment' ? 'Assignment' : `${item.questions} questions`}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-3">No exam attempts yet</h3>
            <p className="text-slate-600 text-base leading-relaxed">Start your first exam to see your activity here.</p>
          </div>
        )}
      </div>

            {/* Exam Tips */}
      <div className="bg-gradient-to-br from-slate-100/50 to-slate-200/30 rounded-3xl border border-slate-300/30 p-6 sm:p-8 hover:shadow-xl transition-all duration-300 shadow-lg">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6 sm:mb-8 flex items-center">
            <div className="w-8 h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-3 hover:scale-105 transition-transform duration-300 shadow-md">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          Exam Tips
        </h2>
        
        <div className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-start space-x-4">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-lg">
                <span className="text-white text-xs sm:text-sm font-bold">1</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 text-base sm:text-lg mb-1 sm:mb-2">Adaptive Questions</h3>
                <p className="text-slate-600 text-sm sm:text-base leading-relaxed">Questions adjust to your skill level in real-time for accurate assessment.</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-4">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-lg">
                <span className="text-white text-xs sm:text-sm font-bold">2</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 text-base sm:text-lg mb-1 sm:mb-2">Time Management</h3>
                <p className="text-slate-600 text-sm sm:text-base leading-relaxed">Keep track of your time and pace yourself throughout the exam.</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-4">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-lg">
                <span className="text-white text-xs sm:text-sm font-bold">3</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 text-base sm:text-lg mb-1 sm:mb-2">Stay Focused</h3>
                <p className="text-slate-600 text-sm sm:text-base leading-relaxed">Read questions carefully and review your answers before submitting.</p>
              </div>
            </div>
        </div>
      </div>

      {/* Guidelines Modal */}
      {showGuidelinesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-gradient-to-br from-white via-slate-50 to-slate-100 rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-slate-200/50">
            <div className="p-5 sm:p-8">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div className="flex items-center">
                                  <div className="w-8 h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-2 shadow-md">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Exam Guidelines</h2>
                </div>
                <button
                  onClick={closeGuidelines}
                  className="w-8 h-8 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-800 hover:from-slate-200 hover:to-slate-300 transition-all duration-300 shadow-md hover:scale-110"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {getCurrentExam() && (
                <>
                  {/* Exam Header */}
                  <div className="bg-gradient-to-br from-white to-slate-50/50 rounded-xl p-3 sm:p-4 border border-slate-200/50 shadow-lg mb-4 sm:mb-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-1 sm:mb-2">{getCurrentExam()!.title}</h3>
                        <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-2 sm:mb-3">{getCurrentExam()!.description}</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {getCurrentExam()!.topics.map((topic: string, index: number) => (
                            <span key={index} className="text-[11px] sm:text-xs bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 px-2.5 py-1.5 rounded-full font-medium border border-slate-300 shadow-sm hover:from-slate-200 hover:to-slate-300 transition-all duration-300">
                              {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="w-8 h-8 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center shadow-md">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Exam Stats */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 p-2.5 sm:p-3 rounded-lg border border-slate-200/50">
                        <div className="flex items-center mb-1">
                          <div className="w-5 h-5 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-lg flex items-center justify-center mr-2 shadow-sm">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <span className="font-semibold text-slate-800 text-xs sm:text-sm">Duration</span>
                        </div>
                        <p className="text-base sm:text-lg font-bold text-[#ff7a59]">{getCurrentExam()!.duration} min</p>
                      </div>
                      
                      <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 p-2.5 sm:p-3 rounded-lg border border-slate-200/50">
                        <div className="flex items-center mb-1">
                          <div className="w-5 h-5 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center mr-2 shadow-sm">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <span className="font-semibold text-slate-800 text-xs sm:text-sm">Questions</span>
                        </div>
                        <p className="text-base sm:text-lg font-bold text-slate-700">{getCurrentExam()!.questionCount}</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* One Attempt Warning */}
                  <div className="mb-4 sm:mb-6">
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl p-4 sm:p-5">
                      <div className="flex items-start">
                        <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 shadow-md">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h4 className="text-base sm:text-lg font-bold text-amber-800 mb-2">⚠️ One Attempt Policy</h4>
                          <p className="text-sm sm:text-base text-amber-700 leading-relaxed">
                            <strong>This exam can only be taken ONCE.</strong> Once you start, you must complete it. 
                            Make sure you have a stable internet connection and are ready to focus before beginning.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Guidelines Section */}
                  <div className="mb-4 sm:mb-6">
                    <h4 className="text-base sm:text-lg font-bold text-slate-800 mb-3 sm:mb-4 flex items-center">
                      <div className="w-5 h-5 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center mr-2 shadow-md">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      Important Guidelines
                    </h4>
                    
                    <div className="grid gap-2">
                      {getCurrentExam()!.guidelines.map((guideline: string, index: number) => (
                        <div key={index} className="group bg-gradient-to-br from-white to-slate-50/50 rounded-lg p-2.5 sm:p-3 border border-slate-200/50 hover:shadow-md hover:scale-[1.005] transition-all duration-300 hover:border-slate-300/70">
                          <div className="flex items-start">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 shadow-sm group-hover:scale-105 transition-transform duration-300 ${
                              index % 3 === 0 ? 'bg-gradient-to-br from-[#ff7a59] to-[#ff7a59]' :
                              index % 3 === 1 ? 'bg-gradient-to-br from-slate-700 to-slate-800' :
                              'bg-gradient-to-br from-slate-600 to-slate-700'
                            }`}>
                              <span className="text-white text-[11px] sm:text-xs font-bold">{index + 1}</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-slate-700 text-xs sm:text-sm leading-relaxed">{guideline}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="border-t border-slate-200/50 pt-4 sm:pt-6">
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                      <button
                        onClick={closeGuidelines}
                        className="flex-1 px-5 sm:px-6 py-2.5 sm:py-3 text-slate-700 bg-gradient-to-r from-slate-100 to-slate-200 rounded-xl font-semibold hover:from-slate-200 hover:to-slate-300 transition-all duration-300 shadow-md hover:scale-[1.02] border border-slate-300/50"
                      >
                        Cancel
                      </button>
                      {getCurrentExam()!.isCompleted ? (
                        <div className="flex-1 inline-flex items-center justify-center bg-gradient-to-r from-green-600 to-green-700 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold border border-green-600 shadow-md">
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Exam Completed
                        </div>
                      ) : (
                        <Link 
                          to={`/app/exam?assignmentId=${getCurrentExam()!.id}`}
                          onClick={closeGuidelines}
                          className="flex-1 inline-flex items-center justify-center bg-gradient-to-r from-[#ff7a59] to-[#ff7a59] text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold hover:from-[#ff7a59]/90 hover:to-[#ff7a59]/90 transition-all duration-300 hover:shadow-lg border border-[#ff7a59] shadow-md hover:scale-[1.02]"
                        >
                          Start Exam
                          <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



