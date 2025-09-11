import type { RequestHandler } from "express";
import admin from "../config/firebase";
import pool from "../config/db";

export const verifyToken: RequestHandler = async (req, res, next) => {
  try {
    const m = /Bearer\s+(.+)/i.exec(req.headers.authorization ?? "");
    if (!m)
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });

    const decoded = await admin.auth().verifyIdToken(m[1]); // ✔️
    const { uid, email } = decoded;

    // 1) by uid (prefer admin if dupes)
    let q = await pool.query(
      `SELECT id,email,role,firebase_uid
         FROM users
        WHERE firebase_uid = $1
     ORDER BY (role='admin') DESC, (role='editor') DESC, id DESC
        LIMIT 1`,
      [uid]
    );

    // 2) by email → attach uid
    if (q.rows.length === 0 && email) {
      const byEmail = await pool.query(
        `SELECT id,email,role,firebase_uid FROM users WHERE lower(email)=lower($1) LIMIT 1`,
        [email]
      );
      if (byEmail.rows.length) {
        const u = byEmail.rows[0];
        if (u.firebase_uid !== uid) {
          await pool.query(`UPDATE users SET firebase_uid=$1 WHERE id=$2`, [
            uid,
            u.id,
          ]);
        }
        q = { rows: [{ ...u, firebase_uid: uid }] } as any;
      }
    }

    // 3) no row → create candidate (optional)
    // if (q.rows.length === 0) {
    //   const created = await pool.query(
    //     `INSERT INTO users (email,firebase_uid,role)
    //          VALUES ($1,$2,'candidate')
    //       RETURNING id,email,role,firebase_uid`,
    //     [email ?? null, uid]
    //   );
    //   q = created;
    // }
    
    const row = q.rows[0];
    (req as any).user = { id: row.id, uid, email: row.email, role: row.role };
    next();
  } catch (e) {
    console.error("verifyToken error:", e);
    res.status(403).json({ error: "Unauthorized or token expired" });
  }
};
