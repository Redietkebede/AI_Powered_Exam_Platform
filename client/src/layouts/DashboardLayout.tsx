import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Menu, LayoutDashboard, Users2, BookOpen, Sparkles, Timer, BarChart2, LogOut } from 'lucide-react';
import { getCurrentUser, logout } from '../services/authService';
import type { User } from '../services/userService';
import logo from '../assets/logo.jpg';

type Role = 'admin' | 'editor' | 'recruiter' | 'candidate';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await getCurrentUser();
        if (!alive) return;
        setUser(me);
        if (!me) navigate('/login', { replace: true });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [navigate]);

  const navItems = [
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/questions', label: 'Question Bank', icon: BookOpen },
    { to: '/app/ai-generator', label: 'Create Questions', icon: Sparkles },
    { to: '/app/approvals', label: 'Approvals', icon: Sparkles },
    { to: '/app/assignments', label: 'Assignments', icon: Timer },
    { to: '/app/results', label: 'Results', icon: BarChart2 },
    { to: '/app/analytics', label: 'Analytics', icon: BarChart2 },
    { to: '/app/users', label: 'User Management', icon: Users2 },
  ];

  // Allowed labels by role (edit as your policy requires)
  const allowedByRole: Record<Role, string[]> = {
    admin: ['Dashboard','User Management', 'Analytics'],
    editor: ['Dashboard', 'Question Bank', 'Create Questions', 'Approvals'],
    recruiter: ['Dashboard', 'Assignments', 'Analytics'],
    candidate: ['Dashboard', 'Results'],
  };

  const filteredNav = useMemo(() => {
    const role = (user?.role ?? '') as Role;
    const allowed = allowedByRole[role] ?? [];
    return navItems.filter(item => allowed.includes(item.label));
  }, [user]);

  return (
    <div className="min-h-screen bg-white md:grid md:grid-cols-[240px,1fr]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200/50 bg-gradient-to-b from-white via-slate-50/30 to-slate-100/20 transition-transform duration-300 md:sticky md:top-0 md:h-screen md:w-auto md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        aria-label="Sidebar"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-20 border-b border-slate-200/50 bg-gradient-to-r from-white to-slate-50/50">
          <div className="flex items-center gap-3">
            <img src={logo} alt="MMCY Logo" className="h-8 w-auto" />
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-8 h-8 bg-gradient-to-r from-slate-100 to-slate-200 rounded-lg flex items-center justify-center hover:from-slate-200 hover:to-slate-300 transition-all duration-300 shadow-sm hover:scale-110 border border-slate-300/50 md:hidden"
            aria-label="Close sidebar"
          >
            <Menu className="h-4 w-4 text-slate-700" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {(loading ? [] : filteredNav).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => {
                  const baseClasses = "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-300";
                  const activeClasses = "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-800 border border-slate-300 shadow-md";
                  const inactiveClasses = "text-slate-600 hover:bg-gradient-to-r hover:from-slate-100/50 hover:to-slate-200/30 hover:text-slate-800 hover:shadow-sm border border-transparent hover:border-slate-200/50";
                  return `${baseClasses} ${isActive ? activeClasses : inactiveClasses}`;
                }}
              >
                {({ isActive }) => (
                  <>
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                        isActive
                          ? 'bg-gradient-to-br from-slate-700 to-slate-800 text-white shadow-md'
                          : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 group-hover:from-slate-200 group-hover:to-slate-300 group-hover:text-slate-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-medium">{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200/50 p-4 bg-gradient-to-br from-slate-50 to-white">
          {/* User Info */}
          <div className="flex items-center mb-4 p-3 bg-gradient-to-r from-slate-100/50 to-slate-200/30 rounded-xl border border-slate-200/50">
            <div className="w-10 h-10 bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] rounded-xl flex items-center justify-center mr-3 shadow-md">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {user?.name ?? '—'}
              </p>
              <p className="text-xs text-slate-600 capitalize">
                {user?.role ?? '—'}
              </p>
            </div>
          </div>

          {/* Sign Out Button */}
          <button
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-slate-100 to-slate-200 hover:from-slate-200 hover:to-slate-300 text-slate-700 px-4 py-3 rounded-xl font-medium transition-all duration-300 hover:shadow-md border border-slate-300/50 hover:scale-[1.02] group"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <div className="w-5 h-5 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <LogOut className="h-3 w-3 text-white" />
            </div>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="min-h-screen bg-neutral-50">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200/60 bg-white md:hidden sticky top-0 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300/60 bg-gradient-to-r from-slate-100 to-slate-200 px-3 py-2 text-slate-700 shadow-sm transition hover:from-slate-200 hover:to-slate-300"
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
            <span className="text-sm font-medium">Menu</span>
          </button>
          <img src={logo} alt="MMCY Logo" className="h-6 w-auto" />
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
