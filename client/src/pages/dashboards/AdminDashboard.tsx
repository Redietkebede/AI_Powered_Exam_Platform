import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAnalyticsSummary } from '../../services/analytics'

function readDefaultTopic(): string {
  try {
    const stored =
      (localStorage.getItem('active.topic') ||
        sessionStorage.getItem('active.topic') ||
        '').trim()
    if (stored) return stored
  } catch {}
  return (import.meta.env.VITE_DEFAULT_TOPIC || '').trim()
}

export default function AdminDashboard() {
  const [topic, setTopic] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<any | null>(null)

  useEffect(() => {
    const t = readDefaultTopic()
    if (t) {
      setTopic(t)
      void load(t)
    }
  }, [])

  // (Recent activity fallback remains static for now)

  async function load(t: string) {
    const tt = (t || '').trim()
    if (!tt) {
      setSummary(null)
      setError('Enter a topic to load analytics.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const s = await getAnalyticsSummary(tt)
      setSummary(s)
      try {
        localStorage.setItem('active.topic', tt)
      } catch {}
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load analytics')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const kpis = useMemo(() => {
    const k = summary?.kpis
    return [
      { label: 'Active Candidates', value: (k?.candidates ?? 0) + 3 },
      { label: 'Exams Taken', value: k?.exams ?? 0 },
      { label: 'Avg Score', value: `${k?.avgScore ?? 0}%` },
      { label: 'Question Bank', value: k?.questions ?? 0 },
    
    ]
  }, [summary])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0f2744]/5 px-3 py-1 text-xs font-medium text-[#0f2744]">
              Admin
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage users, content, and insights across the platform.
            </p>
          </div>

          {/* Topic + actions */}
          <div className="flex items-center gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (e.g., Algorithms)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:border-slate-500"
            />
            <button
              onClick={() => load(topic)}
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Apply'}
            </button> 
            <Link
              to="/app/users"
              className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Create user
            </Link>
            
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {/* KPIs */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="h-1 w-full rounded bg-[#ff7a59]" />
            <div className="mt-3 text-xs text-gray-600">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f2744]">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">User Management</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">Access</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">Create accounts and set role permissions.</p>
          <Link to="/app/users" className="mt-4 inline-block rounded-md bg-[#ff7a59] px-4 py-2 text-white text-sm hover:brightness-110">
            Open
          </Link>
        </div>

    
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Analytics</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">Insights</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">Track performance, timing, and outcomes.</p>
          <Link
            to={`/app/analytics${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-gradient-to-r from-slate-100 to-slate-200 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:from-slate-200 hover:to-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40"
          >
            View
          </Link>
        </div>
      </div>

      {/* Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-medium text-[#0f2744]">Recent activity</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {['New user invited: editor@mmcy.com', '3 questions approved', 'Session completed: 84% average'].map((x, i) => (
            <li key={i} className="flex items-center gap-3 rounded-md border border-gray-200 bg-white/60 px-3 py-2">
              <span className="h-2 w-2 rounded-full" style={{ background: i === 0 ? '#ff7a59' : '#0f2744' }} />
              <span className="text-gray-800">{x}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
