import pool from "../config/db";

// Recompute remaining time from last_event -> now; close session if needed
export async function enforceTimeAndMaybeFinish(sessionId: number) {
  // Lock row
  const sRes = await pool.query(
    `SELECT id, finished_at, deadline_at, time_remaining_seconds, started_at, last_event_at
       FROM exam_sessions
      WHERE id = $1
      FOR UPDATE`,
    [sessionId]
  );
  if (sRes.rowCount === 0) {
    const err: any = new Error("Session not found");
    err.status = 404;
    throw err;
  }
  const s = sRes.rows[0];
  if (s.finished_at) return { finished: true, remaining: 0, deadlineAt: s.deadline_at };

  // seconds since last_event_at (fallback started_at)
  const deltaRes = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - COALESCE($1::timestamptz, NOW())))::int AS d`,
    [s.last_event_at ?? s.started_at]
  );
  const delta = Math.max(0, Number(deltaRes.rows[0].d ?? 0));

  const curRem = Math.max(0, Number(s.time_remaining_seconds ?? 0));
  const newRem = Math.max(0, curRem - delta);

  await pool.query(
    `UPDATE exam_sessions
        SET time_remaining_seconds = $2,
            last_event_at          = NOW()
      WHERE id = $1`,
    [sessionId, newRem]
  );

  const deadlinePassed =
    s.deadline_at && new Date(s.deadline_at).getTime() <= Date.now();

  if (newRem <= 0 || deadlinePassed) {
    await pool.query(
      `UPDATE exam_sessions
          SET finished_at = COALESCE(finished_at, NOW()),
              time_remaining_seconds = 0
        WHERE id = $1`,
      [sessionId]
    );
    return { finished: true, remaining: 0, deadlineAt: s.deadline_at };
  }

  return { finished: false, remaining: newRem, deadlineAt: s.deadline_at };
}
