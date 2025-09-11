import type { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";

export async function verifyFirebaseOnly(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "Missing or invalid Authorization header" });
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    // attach decoded token; do not require DB presence here
    (req as any).firebaseToken = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized or token expired" });
  }
}
