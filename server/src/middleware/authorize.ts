import type { RequestHandler } from "express";

type Role = "admin" | "editor" | "recruiter" | "candidate";

/** Allow only these roles on a route */
export function authorize(allowed: Role[]): RequestHandler {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: "Unauthorized" }); // no user on request
    if (!allowed.includes(role)) {
      return res.status(403).json({ code: "FORBIDDEN", message: "Forbidden: insufficient role", role });
    }
    next();
  };
  
}



/** Optional: hierarchy helper (admin > editor > recruiter > candidate) */
const rank: Record<Role, number> = { admin: 3, editor: 2, recruiter: 1, candidate: 0 };
export function atLeast(min: Role): RequestHandler {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ code: "UNAUTHORIZED", message: "Unauthorized" });
    if (rank[role] < rank[min]) {
      return res.status(403).json({ error: `Forbidden: requires >= ${min}`, role });
    }
    next();
  };
}

/** Optional: complex policy (e.g., owner or admin) */
export function authorizeIf(test: (req: any) => boolean): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!test(req)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
