// server/src/controllers/publishController.ts
import type { RequestHandler } from "express";
import { z } from "zod";
import pool from "../config/db";

/** UI statuses we accept from the FE */
const UiStatus = z.enum([
  "pending",
  "approved",
  "rejected", // moderation words
  "draft",
  "published",
  "archived", // db words
]);
type UiStatusT = z.infer<typeof UiStatus>;

/** What the DB CHECK allows */
type DbStatus = "draft" | "published" | "archived";

/** FE → DB mapping */
const UI_TO_DB: Record<UiStatusT, DbStatus> = {
  pending: "draft",
  approved: "published",
  rejected: "archived",
  draft: "draft",
  published: "published",
  archived: "archived",
};

/** Common SELECT list; alias topic -> topic for FE compatibility */
const SELECT_COLS = `
  id,
  question_text,
  options,
  correct_answer,
  difficulty,
  status,
  topic AS topic,
  tags,
  elo_rating,
  created_at,
  published_at,
  published_by,
  deleted_at,
  explanation
`;

/** GET /api/publish/pending?topic=Algorithms&limit=100&offset=0
 *  “pending” in FE == 'draft' in DB
 */
export const listPending: RequestHandler = async (req, res) => {
  const topic = String(req.query.topic ?? "").trim() || null;
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const params: any[] = [];
  let where = `status = 'draft' AND deleted_at IS NULL`;
  if (topic) {
    params.push(topic);
    where += ` AND topic = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
      SELECT ${SELECT_COLS}
        FROM questions
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  res.json({ items: rows });
};

/** PATCH /api/publish/:id  { status: "approved" | "rejected" | ... } */
export const setStatus: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UiStatus.safeParse(req.body?.status);
  if (!Number.isFinite(id) || !parsed.success) {
    return res.status(400).json({ error: "Invalid id or status" });
  }

  const dbStatus: DbStatus = UI_TO_DB[parsed.data];

  // derive integer publisher id (never pass a string here)
  const raw = (req as any).user?.id;
  const publisherId = Number.isFinite(Number(raw)) ? Number(raw) : null;

  const { rows } = await pool.query(
    `
      UPDATE questions
         SET status       = $2,
             published_at = CASE WHEN $2 = 'published' THEN NOW()     ELSE NULL        END,
             published_by = CASE WHEN $2 = 'published' THEN $3::int   ELSE NULL::int   END
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}
    `,
    [id, dbStatus, publisherId]
  );

  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
};

/** POST /api/publish/:id/approve */
export const approve: RequestHandler = (req, res, next) => {
  req.body = { ...(req.body ?? {}), status: "approved" };
  return setStatus(req, res, next);
};

/** POST /api/publish/:id/reject */
export const reject: RequestHandler = (req, res, next) => {
  req.body = { ...(req.body ?? {}), status: "rejected" };
  return setStatus(req, res, next);
};

/** POST /api/publish/bulk  { ids: number[], action: "publish" | "unpublish" } */
const BulkPublishSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  action: z.enum(["publish", "unpublish"]).default("publish"),
});

export const bulkPublish: RequestHandler = async (req, res) => {
  const parsed = BulkPublishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.format() });
  }
  const { ids, action } = parsed.data;
  const dbStatus: DbStatus = action === "publish" ? "published" : "draft";

  // same integer-only logic for publisher
  const raw = (req as any).user?.id;
  const publisherId = Number.isFinite(Number(raw)) ? Number(raw) : null;

  const { rows } = await pool.query(
    `
      UPDATE questions
         SET status       = $2,
             published_at = CASE WHEN $2 = 'published' THEN NOW()     ELSE NULL        END,
             published_by = CASE WHEN $2 = 'published' THEN $3::int   ELSE NULL::int   END
       WHERE id = ANY($1::int[])
         AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}
    `,
    [ids, dbStatus, publisherId]
  );

  res.json({ items: rows });
};
