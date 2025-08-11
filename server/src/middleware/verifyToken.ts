// src/middleware/verifyToken.ts
import admin from "../config/firebase";
import pool from "../config/db";
import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";

export async function verifyToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const hdr = (req.headers.authorization || "").trim();
    if (!hdr.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const idToken = hdr.slice("Bearer ".length).trim();

    // 1) Verify Firebase ID token
    const decoded = await admin.auth().verifyIdToken(idToken);

    // 2) Try to find a local user by firebase_uid
    let result = await pool.query(
      "SELECT id, role FROM users WHERE firebase_uid = $1 LIMIT 1",
      [decoded.uid]
    );

    // 3) If not found, provision only when email exists
    if (!result.rowCount) {
      if (!decoded.email) {
        return res.status(403).json({ error: "Email required to provision user" });
      }
      const name = decoded.name ?? decoded.email.split("@")[0];
      // role default = candidate; tweak if you need admin/instructor bootstrap
      result = await pool.query(
        `INSERT INTO users (name, email, role, firebase_uid, created_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (firebase_uid) DO NOTHING
         RETURNING id, role`,
        [name, decoded.email, "candidate", decoded.uid]
      );

      // If a concurrent insert happened and RETURNING is empty, fetch again
      if (!result.rowCount) {
        result = await pool.query(
          "SELECT id, role FROM users WHERE firebase_uid = $1 LIMIT 1",
          [decoded.uid]
        );
      }
    }

    // 4) Attach user to req (note: no 'uid' field unless you added it to your type)
    req.user = {
      uid: decoded.uid,
      id: result.rows[0].id,
      role: result.rows[0].role,
      firebaseUid: decoded.uid,
      token: decoded,
    };

    next();
  } catch (err) {
    console.error("[auth] verifyToken error:", err);
    return res.status(403).json({ error: "Unauthorized or token expired" });
  }
}
