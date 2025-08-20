export type User = {
  id: string
  name: string
  email: string
  password: string
  role: 'admin' | 'editor' | 'recruiter' | 'candidate'
}

const KEY = 'ai_exam_users'

function seedIfEmpty() {
  if (localStorage.getItem(KEY)) return
  const seeded: User[] = [
    { id: crypto.randomUUID(), name: 'Alice', email: 'alice@mmcy.com', password: 'password', role: 'admin' },
    { id: crypto.randomUUID(), name: 'Evan', email: 'evan@mmcy.com', password: 'password', role: 'editor' },
    { id: crypto.randomUUID(), name: 'Riley', email: 'riley@mmcy.com', password: 'password', role: 'recruiter' },
    { id: crypto.randomUUID(), name: 'Chris', email: 'chris@mmcy.com', password: 'password', role: 'candidate' },
  ]
  localStorage.setItem(KEY, JSON.stringify(seeded))
}

export function getUsers(): User[] {
  seedIfEmpty()
  const raw = localStorage.getItem(KEY)
  return raw ? (JSON.parse(raw) as User[]) : []
}

export function createUser(partial: Omit<User, 'id'>) {
  const items = getUsers()
  items.push({ id: crypto.randomUUID(), ...partial })
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function updateUserRole(id: string, role: User['role']) {
  const items = getUsers().map((u) => (u.id === id ? { ...u, role } : u))
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function removeUser(id: string) {
  const items = getUsers().filter((u) => u.id !== id)
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function findUserByCredentials(email: string, password: string): User | null {
  const user = getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password)
  return user ?? null
}


