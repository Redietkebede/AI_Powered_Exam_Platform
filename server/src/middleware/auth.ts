import admin from "../config/firebase";
import pool from "../config/db";
import { Request, Response, NextFunction } from "express";

export async function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const hdr = (req.headers.authorization || '').trim();
    if (!hdr.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const idToken = hdr.slice("Bearer ".length).trim();

    const decoded = await admin.auth().verifyIdToken(idToken);

    // Look up your local user by firebase_uid
    const { rows } = await pool.query(
      "SELECT id, role FROM users WHERE firebase_uid = $1 LIMIT 1",
      [decoded.uid]
    );
    if (!rows.length) {
      return res.status(403).json({ error: "User not found" });
    }

    // Assign req.user — now TS knows about it from express.d.ts
    req.user = {
      uid: decoded.uid,
      id: rows[0].id,
      role: rows[0].role,
      firebaseUid: decoded.uid,
      token: decoded
    };

    next();
  } catch (err) {
    console.error("verifyFirebaseToken error:", err);
    return res.status(403).json({ error: "Unauthorized or token expired" });
  }
}
