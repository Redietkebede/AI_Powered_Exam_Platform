import pool from "../config/db";

export async function logActivity(
  actorUserId: number,
  type: string,
  targetType: string,
  targetId?: number,
  meta: any = {},
  orgId?: number | null
) {
  await pool.query(
    `INSERT INTO user_activity (actor_user_id, type, target_type, target_id, meta, org_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorUserId, type, targetType, targetId ?? null, meta, orgId ?? null]
  );
}
