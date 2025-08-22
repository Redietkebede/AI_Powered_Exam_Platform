export type Role = 'admin' | 'editor' | 'recruiter' | 'candidate'
export type SessionUser = { id: string; name: string; email: string; role: Role }

const KEY = 'ai_exam_user'

export function getCurrentUser(): SessionUser | null {
  const raw = localStorage.getItem(KEY)
  return raw ? (JSON.parse(raw) as SessionUser) : null
}

export function login(user: { id?: string; name: string; email: string; role: Role }) {
  const session: SessionUser = { id: user.id ?? crypto.randomUUID(), name: user.name, email: user.email, role: user.role }
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function logout() {
  localStorage.removeItem(KEY)
}


