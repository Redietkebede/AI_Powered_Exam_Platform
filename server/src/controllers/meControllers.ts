import { Request, Response } from 'express';
import pool from '../config/db';

export async function ensureUser(firebaseUid: string, email?: string | null, displayName?: string | null) {
  // Prefer display name, then email prefix, then "User"
  let name =
    (displayName && displayName.trim()) ||
    (email && email.split('@')[0]) ||
    'User';

  // Upsert by firebase_uid; keep existing name if new one is empty
  const { rows } = await pool.query(
    `INSERT INTO users (firebase_uid, email, name, role)
     VALUES ($1, $2, $3, COALESCE((SELECT role FROM users WHERE firebase_uid = $1), 'candidate'))
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email = EXCLUDED.email,
           name  = COALESCE(NULLIF(EXCLUDED.name, ''), users.name)
     RETURNING id`,
    [firebaseUid, email ?? null, name]
  );

  return rows[0].id as number;
}

export async function me(req: Request, res: Response) {
  try {
    const decoded: any = (req as any).user; // set by verifyFirebaseToken
    if (!decoded?.uid) {
      return res.status(401).json({ error: 'No authenticated user' });
    }

    const uid = decoded.uid;
    const email = decoded.email ?? null;
    const displayName = decoded.name ?? decoded.displayName ?? null;

    const userId = await ensureUser(uid, email, displayName);

    const { rows } = await pool.query(
      `SELECT id, firebase_uid, email, name, role
       FROM users
       WHERE id = $1`,
      [userId]
    );

    return res.json(rows[0]);
  } catch (e: any) {
    console.error('me error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}