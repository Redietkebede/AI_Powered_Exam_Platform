import { RequestHandler } from 'express';
import pool from '../config/db'; 
declare global {
  namespace Express {
    interface Request {
      userRole?: string;
    }
  }
}

export const attachUserRole: RequestHandler = async (req, res, next) => {
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

export const restrictTo = (...allowed: string[]): RequestHandler => {
  return (req, res, next) => {
    if (!req.userRole) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowed.includes(req.userRole)) {
      return res.status(403).json({ error: `Forbidden: requires role ${allowed.join(' or ')}` });
    }
    return next();
  };
}
