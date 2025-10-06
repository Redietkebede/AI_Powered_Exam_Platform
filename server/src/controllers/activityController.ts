import { Request, Response } from "express";
import { z } from "zod";
import pool from "../config/db";

const QSchema = z.object({
  sinceDays: z.coerce.number().int().positive().default(7),
  limit: z.coerce.number().int().positive().max(200).default(50),
  scope: z.enum(["admin","editor","recruiter"]).optional(),
  type: z.string().optional(),          // e.g. "exam.completed"
  actorId: z.coerce.number().int().positive().optional(),
  candidateId: z.coerce.number().int().positive().optional(), // if you want to filter by candidate
  topic: z.string().optional(),                                 // for question events
});

function allowedTypesByRole(role: string): string[] | null {
  // null => all types
  switch (role) {
    case "admin":
      return null; // see everything
    case "editor":
      return [
        "questions.created", "questions.edited", "questions.published",
        "exam.completed" // optional if editors should see outcomes
      ];
    case "recruiter":
      return [
        "user.created", "role.changed", "assignment.created",
        "exam.completed"
      ];
    default:
      return [];
  }
}

export async function getActivity(req: Request, res: Response) {
  const Q = QSchema.parse(req.query);

  const user = (req as any).user;               // set by auth middleware
  const role = String(user?.role ?? "recruiter");
  const orgId = user?.org_id ?? null;

  // Role scope guard: non-admin cannot request a different scope than their own
  if (Q.scope && Q.scope !== role && role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const effectiveRole = Q.scope ?? role;

  const sinceIso = new Date(Date.now() - Q.sinceDays * 86400000).toISOString();

  // Build WHERE conditions
  const where: string[] = ["created_at >= $1"];
  const args: any[] = [sinceIso];

  // Tenancy: recruiters/editors should only see their org
  if (orgId && role !== "admin") {
    where.push("org_id = $2");
    args.push(orgId);
  }

  // Role-based types
  const allowed = allowedTypesByRole(effectiveRole);
  if (allowed && allowed.length) {
    where.push(`type = ANY($${args.length + 1})`);
    args.push(allowed);
  }

  if (Q.type) {
    where.push(`type = $${args.length + 1}`);
    args.push(Q.type);
  }
  if (Q.actorId) {
    where.push(`actor_user_id = $${args.length + 1}`);
    args.push(Q.actorId);
  }
  if (Q.candidateId) {
    // we keep candidateId inside meta for exam.completed; adjust if you store denormalized column
    where.push(`(meta->>'candidateId')::bigint = $${args.length + 1}`);
    args.push(Q.candidateId);
  }
  if (Q.topic) {
    where.push(`(meta->>'topic') = $${args.length + 1}`);
    args.push(Q.topic);
  }

  const limitParamIndex = args.length + 1;

  const sql = `
    SELECT id, actor_user_id, type, target_type, target_id, meta, org_id, created_at
    FROM user_activity
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${limitParamIndex}
  `;
  args.push(Q.limit);

  const r = await pool.query(sql, args);
  res.json({ items: r.rows, role: effectiveRole });
}
