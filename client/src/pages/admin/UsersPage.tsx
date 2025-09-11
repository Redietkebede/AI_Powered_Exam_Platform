// client/src/pages/admin/UsersPage.tsx
import { useEffect, useRef, useState } from "react";
import {
  getUsers,
  updateUserRole,
  removeUser,
  createUser,           // make sure this is exported from services/userService
  type User,
  type Role,
} from "../../services/userService";
import { Trash2, UserPlus, Loader2 } from "lucide-react";

/* ───────────────────────────────── RoleSelect ───────────────────────────────── */
function RoleSelect({
  value,
  onChange,
  className = "",
}: {
  value: Role;
  onChange: (r: Role) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const roles: Role[] = ["candidate", "admin", "editor", "recruiter"];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-md border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-800 flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-400"
      >
        <span className="capitalize">{value}</span>
        <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-300/80 bg-white shadow-lg overflow-hidden">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm capitalize transition-colors ${
                r === value ? "bg-slate-100 text-slate-900" : "text-slate-800"
              } hover:bg-slate-200/60`}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────── UsersPage ───────────────────────────────── */
export default function UsersPage() {
  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("candidate");

  // list state
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetch users
  async function load() {
    try {
      setError(null);
      setLoading(true);
      const data = await getUsers({ enrich: false });
      setUsers(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // handlers
  const canCreate = name.trim() && email.trim() && password.length >= 6;

  async function handleCreate() {
    if (!canCreate || saving) return;
    try {
      setSaving(true);
      await createUser({ name: name.trim(), email: email.trim(), password, role });
      setName("");
      setEmail("");
      setPassword("");
      setRole("candidate");
      await load();
    } catch (e: any) {
      alert(`Failed to create user: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(id: number, newRole: Role) {
    const prev = users;
    setUsers((arr) => arr.map((u) => (u.id === id ? { ...u, role: newRole } : u))); // optimistic
    try {
      await updateUserRole(id, newRole);
    } catch (e: any) {
      setUsers(prev); // revert
      alert(`Failed to update role: ${e?.message ?? e}`);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const prev = users;
    setUsers((arr) => arr.filter((u) => u.id !== id)); // optimistic
    try {
      await removeUser(id);
    } catch (e: any) {
      setUsers(prev); // revert
      alert(`Failed to delete: ${e?.message ?? e}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">User Management</h1>
        <div className="hidden sm:flex items-center gap-2 text-sm text-slate-600">
          <span className="h-2 w-2 rounded-full bg-[#ff7a59]" />
          <span>Admin tools</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr,2fr] gap-6">
        {/* Create User */}
        <div className="rounded-xl border border-slate-200/60 bg-gradient-to-b from-white to-slate-50/40 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#ff7a59] to-[#ff7a59] text-white grid place-items-center shadow">
              <UserPlus className="h-4 w-4" />
            </div>
            <h3 className="font-medium text-slate-900">Create User</h3>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300/80 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="mt-1 w-full rounded-md border border-slate-300/80 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="mt-1 w-full rounded-md border border-slate-300/80 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-400"
              />
              <p className="text-xs text-slate-500 mt-1">Min 6 characters.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Role</label>
              <RoleSelect value={role} onChange={setRole} className="mt-1" />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="mt-4 w-full rounded-md bg-[#ff7a59] px-4 py-2 text-white text-sm font-medium hover:brightness-110 shadow disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Creating…</span> : "Add User"}
          </button>
          
        </div>

        {/* Users List */}
        <div className="space-y-3">
          {loading && (
            <div className="rounded-xl border border-slate-200/70 bg-white p-8 text-center text-slate-600">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
          )}

          {!loading && !error && users.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300/70 bg-white p-8 text-center text-slate-600">
              No users
            </div>
          )}

          {!loading && !error && users.map((u) => (
            <div
              key={u.id}
              className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm flex items-center justify-between hover:shadow transition-shadow"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{u.name ?? "—"}</p>
                <p className="text-sm text-slate-600 truncate">
                  {u.email} · {u.role}
                </p>
                {"emailVerified" in u && (
                  <p className="text-xs text-slate-500">
                    {u.emailVerified ? "Verified" : "Unverified"}
                    {u.lastLoginAt ? ` · Last login: ${u.lastLoginAt}` : ""}
                    {u.disabled ? " · Disabled" : ""}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <RoleSelect value={u.role} onChange={(r) => handleRoleChange(u.id, r)} />
                <button
                  onClick={() => handleDelete(u.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300/70 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <Trash2 className="h-4 w-4 text-slate-600" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
