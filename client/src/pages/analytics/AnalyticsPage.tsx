import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { getAnalyticsDetails, getCandidates, getSubjects, type AnalyticsFilters } from '../../services/analyticsService'
import { getCurrentUser } from '../../services/authService'
import { ShieldAlert, Users, Trophy, Activity, Filter } from 'lucide-react'
import { useMemo, useState } from 'react'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend)

export default function AnalyticsPage() {
  const user = getCurrentUser()
  const isAllowed = user?.role === 'admin' || user?.role === 'recruiter'
  const [filters, setFilters] = useState<AnalyticsFilters>({})
  const candidates = useMemo(() => getCandidates(), [])
  const subjects = useMemo(() => getSubjects(), [])
  const summary = getAnalyticsDetails(filters)

  const lineData = {
    labels: summary.timeline.map((t) => t.label),
    datasets: [{ label: 'Average Score', data: summary.timeline.map((t) => t.score), borderColor: '#ff7a59', backgroundColor: 'rgba(255,122,89,0.1)', borderWidth: 3, tension: 0.4 }],
  }
  const barData = {
    labels: summary.byDifficulty.map((b) => b.label),
    datasets: [{ label: 'Avg Score', data: summary.byDifficulty.map((b) => b.score), backgroundColor: ['#ffdacd','#ffc3b0','#ffab94','#ff947b','#ff7a59'], borderRadius: 8, borderSkipped: false }],
  }
  const timeHistData = {
    labels: summary.timeHistogram.labels,
    datasets: [{ label: 'Count', data: summary.timeHistogram.counts, backgroundColor: '#ff7a59', borderRadius: 6 }],
  }



  if (!isAllowed) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-orange-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Access Restricted</h2>
          <p className="text-gray-600">Analytics are available to admins and recruiters only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center mb-8">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center mr-4">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Analytics Dashboard</h1>
          <p className="text-gray-600 mt-1">Comprehensive insights and performance metrics</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {label:'Candidates', value: summary.kpis.candidates, icon: Users, bgColor: 'from-blue-50 to-blue-100', borderColor: 'border-blue-200', textColor: 'text-blue-600'},
          {label:'Exams Taken', value: summary.kpis.exams, icon: Activity, bgColor: 'from-orange-50 to-orange-100', borderColor: 'border-orange-200', textColor: 'text-orange-600'},
          {label:'Avg Score', value: `${summary.kpis.avgScore}%`, icon: Trophy, bgColor: 'from-green-50 to-green-100', borderColor: 'border-green-200', textColor: 'text-green-600'},
          {label:'Questions', value: summary.kpis.questions, icon: Trophy, bgColor: 'from-purple-50 to-purple-100', borderColor: 'border-purple-200', textColor: 'text-purple-600'}
        ].map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-1">{k.label}</div>
                  <div className="text-2xl font-bold text-gray-800">{k.value}</div>
                </div>
                <div className={`w-12 h-12 bg-gradient-to-br ${k.bgColor} rounded-xl flex items-center justify-center border ${k.borderColor}`}>
                  <Icon className={`w-6 h-6 ${k.textColor}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
          <Filter className="w-5 h-5 text-orange-600 mr-2" />
          Filters
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Candidate</label>
            <select 
              value={filters.candidate ?? ''} 
              onChange={(e)=> setFilters((f)=> ({ ...f, candidate: e.target.value || undefined }))} 
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All candidates</option>
              {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Subject</label>
            <select 
              value={filters.subject ?? ''} 
              onChange={(e)=> setFilters((f)=> ({ ...f, subject: e.target.value || undefined }))} 
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All subjects</option>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
            <select 
              value={(filters.difficulty as any) ?? ''} 
              onChange={(e)=> setFilters((f)=> ({ ...f, difficulty: (e.target.value as any) || undefined }))} 
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">All difficulties</option>
              {['Very Easy','Easy','Medium','Hard','Very Hard'].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{summary.kpis.exams}</span> exams · 
            <span className="font-medium"> {summary.kpis.candidates}</span> candidates · 
            <span className="font-medium"> {summary.kpis.avgScore}%</span> avg score
          </div>
          <button 
            onClick={()=> setFilters({})} 
            className="rounded-xl border border-orange-200 text-orange-700 px-4 py-2 text-sm font-medium hover:bg-orange-50 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <svg className="w-4 h-4 text-orange-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Performance Over Time
          </h3>
          <div className="mt-4">
            <Line 
              data={lineData} 
              options={{ 
                responsive: true, 
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                  },
                  x: {
                    grid: { color: 'rgba(0,0,0,0.05)' }
                  }
                }
              }} 
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <svg className="w-4 h-4 text-orange-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Scores by Difficulty
          </h3>
          <div className="mt-4">
            <Bar 
              data={barData} 
              options={{ 
                responsive: true, 
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                  },
                  x: {
                    grid: { display: false }
                  }
                }
              }} 
            />
          </div>
        </div>
      </div>

      {/* Subject and time insights */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <svg className="w-4 h-4 text-orange-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Subject Insights
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left p-3 font-semibold text-gray-800">Subject</th>
                  <th className="text-left p-3 font-semibold text-gray-800">Accuracy</th>
                  <th className="text-left p-3 font-semibold text-gray-800">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {summary.subjectStats.map((row, index) => (
                  <tr key={row.subject} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                    <td className="p-3 font-medium text-gray-800">{row.subject}</td>
                    <td className="p-3">
                      <span className={`font-bold text-lg ${row.accuracy >= 70 ? 'text-green-600' : row.accuracy >= 50 ? 'text-orange-600' : 'text-red-600'}`}>
                        {row.accuracy}%
                      </span>
                    </td>
                    <td className="p-3 text-gray-700">{row.avgTimeSec}s</td>
                  </tr>
                ))}
                {summary.subjectStats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-gray-500">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <svg className="w-4 h-4 text-orange-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Time Spent Distribution
          </h3>
          <div className="mt-4">
            <Bar 
              data={timeHistData} 
              options={{ 
                responsive: true, 
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                  },
                  x: {
                    grid: { display: false }
                  }
                }
              }} 
            />
          </div>
        </div>
      </div>

      {/* Top performers and recent activity */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <Trophy className="w-4 h-4 text-orange-600 mr-2" />
            Top Performers
          </h3>
          <div className="space-y-4">
            {summary.topPerformers.map((p, index) => (
              <div key={p.candidate} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm mr-3 ${
                    index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : index === 2 ? 'bg-orange-500' : 'bg-gray-300'
                  }`}>
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium text-gray-800">{p.candidate}</div>
                    <div className="text-sm text-gray-600">{p.attempts} attempts</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-orange-600 text-lg">{p.score}%</div>
                  <div className="text-xs text-gray-500">{p.lastActive}</div>
                </div>
              </div>
            ))}
            {summary.topPerformers.length === 0 && (
              <div className="text-center text-gray-500 py-8">No performance data available</div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <Activity className="w-4 h-4 text-orange-600 mr-2" />
            Recent Activity
          </h3>
          <div className="space-y-4">
            {summary.recentActivity.map((activity) => (
              <div key={`${activity.candidate}-${activity.date}`} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-800">{activity.candidate}</div>
                  <div className="text-sm text-gray-600">{new Date(activity.date).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-orange-600">{activity.score}%</div>
                  <div className="text-xs text-gray-500">{activity.correct}/{activity.total}</div>
                </div>
              </div>
            ))}
            {summary.recentActivity.length === 0 && (
              <div className="text-center text-gray-500 py-8">No recent activity</div>
            )}
          </div>
        </div>
      </div>


    </div>
  )
}