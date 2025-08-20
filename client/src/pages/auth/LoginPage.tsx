import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../../services/authService'
import { findUserByCredentials, getUsers } from '../../services/userService'
import logo from '../../assets/logo.jpg'

type Props = { onLogin?: (role: string) => void }

export default function LoginPage({ onLogin }: Props) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [rolePickerOpen, setRolePickerOpen] = useState(false)

  return (
    <div className="relative min-h-screen">
      {/* MMCY palette background */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-700 to-[#ff7a59]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-white/15 bg-white/10 p-6 shadow-xl backdrop-blur">
          <div className="flex items-center">
            <span className="inline-flex items-center justify-center rounded-md p-1 bg-gradient-to-r from-slate-800 via-slate-700 to-[#ff7a59]">
              <img src={logo} alt="MMCY Logo" className="h-8 w-auto" />
            </span>
          </div>
          <h2 className="mt-4 text-lg font-medium text-white">Sign in</h2>

          <label className="mt-4 block text-sm font-medium text-white/90">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            type="email"
            className="mt-1 w-full rounded-md border border-white/20 bg-white/90 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
          />

          <label className="mt-4 block text-sm font-medium text-white/90">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            className="mt-1 w-full rounded-md border border-white/20 bg-white/90 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
          />

          {error && <p className="mt-3 text-sm text-orange-200">{error}</p>}

          <div className="mt-3 text-xs text-white/80">Tip: Admin demo is admin@example.com / admin123</div>

          <button
            onClick={() => {
              if (!email || !password) return setError('Enter email and password')
              // Admin shortcut or any user created by Admin
              const builtInAdmin = email.toLowerCase() === 'admin@example.com' && password === 'admin123'
              const user = builtInAdmin ? { id: 'builtin-admin', name: 'Administrator', email, role: 'admin' as const } : findUserByCredentials(email, password)
              if (!user) return setError('Invalid credentials')
              setError('')
              login({ id: (user as any).id, name: (user as any).name, email: (user as any).email, role: (user as any).role })
              onLogin?.((user as any).role)
              navigate('/app')
            }}
            className="mt-5 w-full rounded-md bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Sign in
          </button>

          <div className="mt-4 flex items-center justify-between text-xs text-white/80">
            <span>Need a role?</span>
            <button onClick={() => setRolePickerOpen((v) => !v)} className="underline">Switch role (dev)</button>
          </div>

          {rolePickerOpen && (
            <div className="mt-3 rounded-md border border-white/15 bg-white/10 p-3 text-xs text-white/90">
              <div className="mb-2 font-medium">Quick role switch</div>
              <div className="grid grid-cols-2 gap-2">
                {['admin','editor','recruiter','candidate'].map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      const existing = getUsers().find(u => u.role === (r as any))
                      if (existing) {
                        login({ id: existing.id, name: existing.name, email: existing.email, role: existing.role })
                        onLogin?.(r)
                        navigate('/app')
                        return
                      }
                      const demoEmail = `${r}@demo.local`
                      login({ name: r.toUpperCase(), email: demoEmail, role: r as any })
                      onLogin?.(r)
                      navigate('/app')
                    }}
                    className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


