import type { RequestHandler } from "express";
import admin from "../config/firebase";
import pool from "../config/db";

export const verifyToken: RequestHandler = async (req, res, next) => {
  try {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    if (!m) return res.status(401).json({ error: "Missing or invalid Authorization header" });
    const decoded = await admin.auth().verifyIdToken(m[1]);

    const { rows } = await pool.query(
      "SELECT id, role FROM users WHERE firebase_uid = $1 LIMIT 1",
      [decoded.uid]
    );
    if (!rows.length) return res.status(403).json({ error: "User not found" });

    req.user = {
      id: rows[0].id,
      uid: decoded.uid,
      role: rows[0].role,
      firebaseUid: decoded.uid,
      email: decoded.email ?? null,
      token: decoded,
    };
    next();
  } catch (e) {
    console.error("verifyToken error:", e);
    res.status(403).json({ error: "Unauthorized or token expired" });
  }
};
