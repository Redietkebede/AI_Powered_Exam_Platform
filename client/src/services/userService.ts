// client/src/services/userService.ts
import { request } from "../lib/api";

export type Role = "admin" | "editor" | "recruiter" | "candidate";

/** Raw row as it comes from the DB/BE (snake_case). */
type DBUserRow = {
  id: number | string;
  firebase_uid?: string | null;   // if present in your table/view
  name?: string | null;
  email: string;
  role: string;                   // varchar(20) in DB
  created_at?: unknown;           // timestamptz | string | number | null
  // optional enrich fields if BE merges Firebase data:
  email_verified?: boolean | null;
  last_login_at?: unknown;        // date-like | string | number | null
  disabled?: boolean | null;
};

/** App-facing User (camelCase, normalized). */
export type User = {
  id: number;
  uid: string | null;
  name: string;                   // empty string if null
  email: string;
  role: Role;
  createdAt?: string;             // ISO string (optional if unparsable)
  emailVerified?: boolean | null;
  lastLoginAt?: string | null;    // ISO or null
  disabled?: boolean | null;
};

export type Me = {
  id: number;
  uid: string | null;
  name: string | null;
  email: string | null;
  role: Role;
};

const USERS_PATH = "/users";
const AUTH_ME_PATH = "/auth/me";

/* ---------------------- helpers ---------------------- */

function toIso(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "number") {
    const ms = String(val).length === 10 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function asRole(v: unknown): Role {
  const s = String(v ?? "").toLowerCase();
  if (s === "admin" || s === "editor" || s === "recruiter" || s === "candidate") return s;
  return "candidate";
}

function normalizeUserRow(r: DBUserRow): User {
  return {
    id: Number(r.id),
    uid: (r.firebase_uid ?? null) as string | null,
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    role: asRole(r.role),
    createdAt: toIso(r.created_at),
    emailVerified: r.email_verified ?? null,
    lastLoginAt: (toIso(r.last_login_at) ?? null),
    disabled: r.disabled ?? null,
  };
}

/* ---------------------- API ---------------------- */

// Current user
export async function getCurrentUser(): Promise<Me> {
  return request<Me>(AUTH_ME_PATH);
}

// List users (admin). Pass { enrich: true } to let BE merge Firebase fields.
// replace ONLY this function in userService.ts

export async function getUsers(opts?: { enrich?: boolean }): Promise<User[]> {
  const wantEnrich = !!opts?.enrich;
  const url = `${USERS_PATH}${wantEnrich ? "?enrich=1" : ""}`;

  try {
    const raw = await request<DBUserRow[] | { items: DBUserRow[] }>(url);
    const rows = Array.isArray(raw) ? raw : raw?.items ?? [];
    return rows.map(normalizeUserRow);
  } catch (e: any) {
    // If the BE’s enrich branch is buggy (e.g., toISOString on a string), retry plain.
    if (wantEnrich && (e?.status === 400 || e?.status === 500)) {
      const raw = await request<DBUserRow[] | { items: DBUserRow[] }>(USERS_PATH);
      const rows = Array.isArray(raw) ? raw : raw?.items ?? [];
      return rows.map(normalizeUserRow);
    }
    throw e;
  }
}


// Create user
export type CreateUserInput = {
  email: string;
  name?: string;
  role: Role;
  password?: string; // optional; BE may auto-generate if missing
};

export async function createUser(input: CreateUserInput): Promise<User> {
  const body = {
    email: input.email.trim(),
    name: input.name?.trim() || undefined,
    role: input.role,
    password: input.password && input.password.length >= 6 ? input.password : undefined,
  };
  const row = await request<DBUserRow>(USERS_PATH, { method: "POST", body });
  return normalizeUserRow(row);
}

// Update role
export async function updateUserRole(id: number, role: Role): Promise<void> {
  await request(`${USERS_PATH}/${id}`, { method: "PATCH", body: { role } });
}

// Delete user
export async function removeUser(id: number): Promise<void> {
  await request(`${USERS_PATH}/${id}`, { method: "DELETE" });
}

/* ----------------- legacy mock purge (unchanged) ----------------- */

const MOCK_PREFIXES = ["ai_exam_users", "ai_exam_user", "ai_exam_session", "ai_exam_auth"];
export function purgeMockUsers(): void {
  try {
    const ls = window.localStorage;
    for (const key of Object.keys(ls)) {
      if (MOCK_PREFIXES.some((p) => key.startsWith(p))) ls.removeItem(key);
    }
  } catch { /* ignore */ }
}
if (import.meta.env.DEV) (window as any).purgeMockUsers = purgeMockUsers;
