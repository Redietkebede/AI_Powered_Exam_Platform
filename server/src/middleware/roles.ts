import { Request, Response, NextFunction } from 'express';
import pool from '../config/db'; 
import { AuthRequest } from '../types/AuthRequest';

// attach `req.userRole` for convenience
declare global {
  namespace Express {
    interface Request {
      userRole?: string;
    }
  }
}

/**
 * Loads the user's role from DB based on Firebase UID and attaches to req.userRole.
 * Call this AFTER verifyFirebaseToken.
 */
export async function attachUserRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const { rows } = await pool.query(
      `SELECT role FROM users WHERE firebase_uid = $1 LIMIT 1`,
      [uid]
    );

    // If user not in DB yet, default to candidate (or upsert elsewhere)
    req.userRole = rows[0]?.role ?? 'candidate';
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Restrict access to allowed roles.
 * Usage: router.post('/x', verifyFirebaseToken, attachUserRole, restrictTo('admin','editor'), handler)
 */
export function restrictTo(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userRole) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowed.includes(req.userRole)) {
      return res.status(403).json({ error: `Forbidden: requires role ${allowed.join(' or ')}` });
    }
    return next();
  };
}
