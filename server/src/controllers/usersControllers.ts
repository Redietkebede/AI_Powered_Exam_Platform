import type { RequestHandler } from "express";
import admin from "../config/firebase";
import pool from "../config/db";

export type Role = "admin" | "editor" | "recruiter" | "candidate";
const VALID_ROLES: Role[] = ["admin", "editor", "recruiter", "candidate"];

// ────────────────────────────────────────────────────────────
// Upsert a user row by firebase UID; preserve existing role if present.
export async function ensureUser(
  firebaseUid: string,
  email: string | null,
  displayName?: string | null
): Promise<number> {
  const name =
    (displayName && displayName.trim()) ||
    (email && email.split("@")[0]) ||
    "User";

  const { rows } = await pool.query(
    `
    INSERT INTO users (firebase_uid, email, name, role)
    VALUES ($1, $2, $3, COALESCE(
      (SELECT role FROM users WHERE firebase_uid = $1),
      'candidate'
    ))
    ON CONFLICT (firebase_uid) DO UPDATE
      SET email = EXCLUDED.email,
          name  = COALESCE(NULLIF(EXCLUDED.name, ''), users.name)
    RETURNING id
    `,
    [firebaseUid, email ?? null, name]
  );
  return rows[0].id as number;
}

// GET /auth/me  (token-only verify; auto-provision in DB)
export const me: RequestHandler = async (req, res) => {
  try {
    // Accept either verifyFirebaseOnly or your older verifyToken
    const decoded: any = (req as any).firebaseToken ?? (req as any).user;
    if (!decoded?.uid) return res.status(401).json({ error: "No authenticated user" });

    const uid = decoded.uid as string;
    const email: string | null = decoded.email ?? null;
    const displayName: string | null = decoded.name ?? decoded.displayName ?? null;

    const userId = await ensureUser(uid, email, displayName);

    const { rows } = await pool.query(
      `SELECT id, firebase_uid AS uid, email, name, role
         FROM users
        WHERE id = $1`,
      [userId]
    );

    return res.json(rows[0]);
  } catch (e: any) {
    console.error("me error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
};

// ────────────────────────────────────────────────────────────
// Admin endpoints

// GET /users?enrich=1
const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    const ms = String(v).length === 10 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    // pg returns TIME WITH TIME ZONE as "HH:mm:ss.ssssss+ZZ"
    // Prefix a dummy date so JS can parse consistently.
    const looksTimeOnly = /^\d{2}:\d{2}/.test(v) && !/\d{4}-\d{2}-\d{2}/.test(v);
    const s = looksTimeOnly ? `1970-01-01T${v}` : v;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

export const listUsers: RequestHandler = async (req, res) => {
  const enrich = String(req.query.enrich ?? "") === "1";

  const { rows } = await pool.query(
    `
    SELECT id,
           firebase_uid AS uid,
           email,
           name,
           role,
           created_at
    FROM users
    ORDER BY created_at DESC
    `
  );

  let items = rows.map((r: any) => ({
    id: Number(r.id),
    uid: (r.uid ?? null) as string | null,
    email: String(r.email ?? ""),
    name: (r.name ?? null) as string | null,
    role: String(r.role ?? "candidate") as Role,
    createdAt: toIso(r.created_at), // ✅ safe for Date|string|number|null (incl. TIME WITH TZ)
  }));

  if (enrich) {
    const extras = await Promise.all(
      items.map(async (u) => {
        if (!u.uid) return { emailVerified: null, lastLoginAt: null, disabled: null };
        try {
          const fu = await admin.auth().getUser(u.uid);
          return {
            emailVerified: fu.emailVerified ?? null,
            lastLoginAt: toIso(fu.metadata?.lastSignInTime ?? null), // ✅ normalize Firebase string
            disabled: !!fu.disabled,
          };
        } catch {
          return { emailVerified: null, lastLoginAt: null, disabled: null };
        }
      })
    );
    items = items.map((u, i) => ({ ...u, ...extras[i] }));
  }

  return res.json({ items });
};

// POST /users   { email, name?, role, password? }
export const createUser: RequestHandler = async (req, res) => {
  try {
    const { email, name, role, password } = req.body as {
      email: string;
      name?: string;
      role: Role;
      password?: string;
    };

    if (!email || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "email and valid role are required" });
    }

    // Create Firebase user (or fetch if already exists)
    let fbUser;
    try {
      fbUser = await admin.auth().createUser({
        email,
        displayName: name,
        password: password && password.length >= 6 ? password : undefined,
      });
    } catch (e: any) {
      if (e?.code === "auth/email-already-exists") {
        fbUser = await admin.auth().getUserByEmail(email);
      } else {
        throw e;
      }
    }

    // Upsert DB row with requested role
    const { rows } = await pool.query(
      `
      INSERT INTO users (firebase_uid, email, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (firebase_uid) DO UPDATE
        SET email = EXCLUDED.email,
            name  = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
            role  = EXCLUDED.role
      RETURNING id, firebase_uid AS uid, email, name, role, created_at
      `,
      [fbUser.uid, email, name ?? fbUser.displayName ?? null, role]
    );

    return res.status(201).json(rows[0]);
  } catch (e: any) {
    console.error("createUser error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
};

// PATCH /users/:id   { role?, name?, email?, password?, disabled? }
export const updateUser: RequestHandler = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role, name, email, password, disabled } = req.body as Partial<{
      role: Role;
      name: string;
      email: string;
      password: string;
      disabled: boolean;
    }>;

    const { rows: existingRows } = await pool.query(
      `SELECT id, firebase_uid AS uid, email, name, role FROM users WHERE id = $1`,
      [id]
    );
    if (!existingRows.length) return res.status(404).json({ error: "User not found" });
    const existing = existingRows[0];

    // Update Firebase account if we have a UID
    if (existing.uid) {
      const updates: any = {};
      if (typeof name === "string") updates.displayName = name;
      if (typeof email === "string") updates.email = email;
      if (typeof password === "string" && password.length >= 6) updates.password = password;
      if (typeof disabled === "boolean") updates.disabled = disabled;
      if (Object.keys(updates).length > 0) {
        await admin.auth().updateUser(existing.uid, updates);
      }
    }

    // Update DB
    const nextRole = role && VALID_ROLES.includes(role) ? role : existing.role;
    const { rows } = await pool.query(
      `
      UPDATE users
         SET name  = COALESCE($1, name),
             email = COALESCE($2, email),
             role  = $3
       WHERE id   = $4
      RETURNING id, firebase_uid AS uid, email, name, role, created_at
      `,
      [name ?? null, email ?? null, nextRole, id]
    );

    return res.json(rows[0]);
  } catch (e: any) {
    console.error("updateUser error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
};

// DELETE /users/:id
export const deleteUser: RequestHandler = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: userRows } = await pool.query(
      `SELECT firebase_uid AS uid FROM users WHERE id = $1`,
      [id]
    );
    if (!userRows.length) return res.status(404).json({ error: "User not found" });

    const uid = userRows[0].uid as string | null;

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    if (uid) {
      try {
        await admin.auth().deleteUser(uid);
      } catch {
        // ignore if the Firebase user is already gone
      }
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("deleteUser error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
};
