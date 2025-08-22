import { Link } from 'react-router-dom'
import { getQuestions } from '../../services/questionService'

export default function EditorDashboard() {
  const questions = getQuestions()
  const counts = {
    pending: questions.filter((q) => q.status === 'pending').length,
    draft: questions.filter((q) => q.status === 'draft').length,
    approved: questions.filter((q) => q.status === 'approved').length,
    rejected: questions.filter((q) => q.status === 'rejected').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0f2744]/5 px-3 py-1 text-xs font-medium text-[#0f2744]">Editor</div>
            <h1 className="mt-3 text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">Create, review, and approve exam content.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/app/ai-generator" className="rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110">Create questions</Link>
            <Link to="/app/questions" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Question bank</Link>
          </div>
        </div>
      </div>

      {/* Content status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[{label:'Pending', value: counts.pending, tone:'bg-amber-50 text-amber-700 border-amber-200'}, {label:'Drafts', value: counts.draft, tone:'bg-gray-50 text-gray-700 border-gray-200'}, {label:'Approved', value: counts.approved, tone:'bg-emerald-50 text-emerald-700 border-emerald-200'}, {label:'Rejected', value: counts.rejected, tone:'bg-rose-50 text-rose-700 border-rose-200'}].map((k) => (
          <div key={k.label} className={`rounded-lg border ${k.tone.split(' ').at(-1)} bg-white p-5 shadow-sm`}>
            <div className={`h-1 w-full rounded ${k.tone.split(' ')[0]}`} />
            <div className="mt-3 text-xs text-gray-600">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#0f2744]">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Question Bank</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">Content</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">Create, edit, and organize questions.</p>
          <Link to="/app/questions" className="mt-4 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Open</Link>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Create Questions</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">AI</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">Create new questions (manual or assisted).</p>
          <Link to="/app/ai-generator" className="mt-4 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Open</Link>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#0f2744]">Approvals</h3>
            <span className="rounded-md bg-[#0f2744]/5 px-2 py-1 text-xs text-[#0f2744]">Review</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">Approve pending and draft content.</p>
          <div className="mt-3 text-xs text-gray-600">Pending: <span className="font-medium text-[#0f2744]">{counts.pending}</span> · Drafts: <span className="font-medium text-[#0f2744]">{counts.draft}</span></div>
          <Link to="/app/approvals" className="mt-4 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Open</Link>
        </div>
      </div>
    </div>
  )
}

