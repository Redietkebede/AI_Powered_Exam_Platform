import './App.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'

import LoginPage from './pages/auth/LoginPage'
import LandingPage from './pages/LandingPage'
import DashboardLayout from './layouts/DashboardLayout'
import CandidateDashboard from './pages/dashboards/CandidateDashboard'
import AdminDashboard from './pages/dashboards/AdminDashboard'
import EditorDashboard from './pages/dashboards/EditorDashboard'
import RecruiterDashboard from './pages/dashboards/RecruiterDashboard'
import QuestionBankPage from './pages/questions/QuestionBankPage'
import AiGeneratorPage from './pages/questions/AiGeneratorPage'
import ApprovalsPage from './pages/questions/ApprovalsPage'
import ResultsPage from './pages/exams/ResultsPage'
import ExamPage from './pages/exams/ExamPage'
import AnalyticsPage from './pages/analytics/AnalyticsPage'
import UsersPage from './pages/admin/UsersPage'
import AssignmentsPage from './pages/assignments/AssignmentsPage'
import NotFoundPage from './pages/NotFoundPage'
import { getCurrentUser } from './services/authService'

function App() {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    const user = getCurrentUser()
    setRole(user?.role ?? null)
    setBootstrapped(true)
  }, [])

  const RequireRole = ({ allow, children }: { allow: string[]; children: ReactNode }) => {
    if (!bootstrapped) return null
    if (!role) return <Navigate to="/login" replace />
    if (!allow.includes(role)) return <Navigate to="/" replace />
    return children
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage onLogin={(r) => setRole(r)} />} />

        <Route
          path="/app"
          element={
            <RequireRole allow={["candidate", "admin", "editor", "recruiter"]}>
              <DashboardLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              role === 'admin' ? (
                <AdminDashboard />
              ) : role === 'editor' ? (
                <EditorDashboard />
              ) : role === 'recruiter' ? (
                <RecruiterDashboard />
              ) : (
                <CandidateDashboard />
              )
            }
          />
          <Route
            path="questions"
            element={
              <RequireRole allow={["admin", "editor"]}>
                <QuestionBankPage />
              </RequireRole>
            }
          />
          <Route
            path="ai-generator"
            element={
              <RequireRole allow={["admin", "editor"]}>
                <AiGeneratorPage />
              </RequireRole>
            }
          />
          <Route
            path="approvals"
            element={
              <RequireRole allow={["admin", "editor"]}>
                <ApprovalsPage />
              </RequireRole>
            }
          />
          <Route
            path="assignments"
            element={
              <RequireRole allow={["recruiter", "admin"]}>
                <AssignmentsPage />
              </RequireRole>
            }
          />
          <Route path="results" element={<ResultsPage />} />
          <Route path="exam" element={<ExamPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route
            path="users"
            element={
              <RequireRole allow={["admin"]}>
                <UsersPage />
              </RequireRole>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
