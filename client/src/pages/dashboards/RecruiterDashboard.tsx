import { Link } from 'react-router-dom'
import { getAnalyticsDetails } from '../../services/analyticsService'
import { Users, Activity, Trophy, ClipboardList, ArrowRight, Timer, Settings2, PlusCircle, CalendarDays } from 'lucide-react'

import { useEffect, useState } from 'react'

type AnalyticsSummary = Awaited<ReturnType<typeof getAnalyticsDetails>>

export default function RecruiterDashboard() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const data = await getAnalyticsDetails("")
        if (alive) setSummary(data)
      } catch {
        if (alive) setSummary(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  if (loading || !summary) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-gray-500">Loading dashboard...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff7a59] to-[#ff6b4a] text-white shadow-sm">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0f2744]">Recruiter Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">Assign assessments, schedule windows, and track outcomes.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/app/assignments" className="inline-flex items-center gap-2 rounded-xl bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110">
              <PlusCircle className="h-4 w-4" /> New Assignment
            </Link>
            <Link to="/app/analytics" className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
              <ArrowRight className="h-4 w-4" /> View Analytics
            </Link>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[{label:'Candidates', value: summary.kpis.candidates, icon: Users, tone:'bg-[#0f2744]/10 text-[#0f2744]'}, {label:'Exams Taken', value: summary.kpis.exams, icon: Activity, tone:'bg-[#ff7a59]/10 text-[#ff7a59]'}, {label:'Avg Score', value: `${summary.kpis.avgScore}%`, icon: Trophy, tone:'bg-[#0f2744]/10 text-[#0f2744]'}, {label:'Question Bank', value: summary.kpis.questions, icon: ClipboardList, tone:'bg-[#ff7a59]/10 text-[#ff7a59]'}].map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600">{k.label}</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f2744]">{k.value}</div>
                </div>
                <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${k.tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Actions */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {summary.recentActivity.slice(0, 5).map((a: { candidate: string; date: string; score: number; correct: number; total: number }) => (
            <li key={`${a.candidate}-${a.date}`} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
              <span className="font-medium text-[#0f2744]">{a.candidate}</span> scored {a.score}% ({a.correct}/{a.total}) · {new Date(a.date).toLocaleString()}
            </li>
          ))}
          {summary.recentActivity.length === 0 && (
            <li className="rounded border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-gray-500">No recent activity.</li>
          )}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Templates</h3>
            <Settings2 className="h-4 w-4 text-[#0f2744]" />
          </div>
          <p className="mt-2 text-sm text-gray-600">Save and reuse common assignment configurations.</p>
          <button className="mt-4 inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Coming soon</button>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Schedule</h3>
            <CalendarDays className="h-4 w-4 text-[#0f2744]" />
          </div>
          <p className="mt-2 text-sm text-gray-600">Plan windows and track upcoming sessions.</p>
          <Link to="/app/assignments" className="mt-4 inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Manage <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="font-medium text-[#0f2744]">Recent Activity</h3>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          {summary.recentActivity.slice(0, 5).map((a) => (
            <li key={`${a.candidate}-${a.date}`} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
              <span className="font-medium text-[#0f2744]">{a.candidate}</span> scored {a.score}% ({a.correct}/{a.total}) · {new Date(a.date).toLocaleString()}
            </li>
          ))}
          {summary.recentActivity.length === 0 && (
            <li className="rounded border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-gray-500">No recent activity.</li>
          )}
        </ul>
      </div>
    </div>
  )
}




