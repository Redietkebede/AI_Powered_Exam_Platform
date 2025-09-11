import { getAuth, onAuthStateChanged } from "firebase/auth";
import "./lib/firebase";

import LoginPage from "./pages/auth/LoginPage";
import LandingPage from "./pages/LandingPage";
import DashboardLayout from "./layouts/DashboardLayout";
import CandidateDashboard from "./pages/dashboards/CandidateDashboard";
import AdminDashboard from "./pages/dashboards/AdminDashboard";
import EditorDashboard from "./pages/dashboards/EditorDashboard";
import RecruiterDashboard from "./pages/dashboards/RecruiterDashboard";
import QuestionBankPage from "./pages/questions/QuestionBankPage";
import AiGeneratorPage from "./pages/questions/QuestionCreationPage";
import ApprovalsPage from "./pages/questions/ApprovalsPage";
import ResultsPage from "./pages/exams/ResultsPage";
import ExamPage from "./pages/exams/ExamPage";
import AnalyticsPage from "./pages/analytics/AnalyticsPage";
import UsersPage from "./pages/admin/UsersPage";
import AssignmentsPage from "./pages/assignments/AssignmentsPage";
import NotFoundPage from "./pages/NotFoundPage";

import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { setToken, getCurrentUser } from "./services/authService";
import type { User } from "./services/userService";

function App() {
  // bootstrap/auth state
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // 1) Firebase auth -> warm token -> fetch backend user (role)
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), async (fbUser) => {
      try {
        if (!fbUser) {
          setUser(null);
          return;
        }
        // force a fresh ID token and warm the client cache for subsequent API calls
        const fresh = await fbUser.getIdToken(true);
        setToken(fresh);

        // now ask BE who we are (role, etc.)
        const me = await getCurrentUser();
        setUser(me ?? null);
      } finally {
        setBootstrapped(true);
      }
    });
    return () => unsub();
  }, []);

  // 2) Optional prefetch: only after auth and NOT on /login; only admin/editor
  useEffect(() => {
    if (!user) return;
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    if (path.startsWith("/login")) return;
  }, [user]);

  // Route guard: wait for bootstrap; require user; then check role
  const RequireRole = ({
    allow,
    children,
  }: {
    allow: string[];
    children: ReactNode;
  }) => {
    if (!bootstrapped) return null; // still resolving auth/me
    if (!user) return <Navigate to="/login" replace />; // not signed in
    const r = String(user.role || "").toLowerCase();
    if (!allow.includes(r)) return <Navigate to="/" replace />;
    return <>{children}</>;
  };

  const role = String(user?.role || "").toLowerCase();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* If already signed in, skip login */}
        <Route
          path="/login"
          element={
            user ? <Navigate to="/app/dashboard" replace /> : <LoginPage />
          }
        />

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
              role === "admin" ? (
                <AdminDashboard />
              ) : role === "editor" ? (
                <EditorDashboard />
              ) : role === "recruiter" ? (
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
  );
}

export default App;
