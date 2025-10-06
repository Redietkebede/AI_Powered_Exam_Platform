// simple reader for the unified /api/activity endpoint
import { request } from "../lib/api";

export type ActivityItem = {
  id: number;
  message: string;          // server may return "display" or "message"
  created_at: string;       // ISO
};

export async function getActivityFeed(
  scope: "admin" | "editor" | "recruiter",
  opts?: { sinceDays?: number; limit?: number; type?: string }
): Promise<ActivityItem[]> {
  const qs = new URLSearchParams();
  qs.set("scope", scope);
  if (opts?.sinceDays) qs.set("sinceDays", String(opts.sinceDays));
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.type) qs.set("type", opts.type);

  const res = await request<{ items: any[] }>(`/activity?${qs.toString()}`);

  // normalize a bit so dashboards can just render
  return (res.items ?? []).map((r: any) => ({
    id: r.id,
    message: r.display ?? r.message ?? r.type,
    created_at: r.created_at ?? r.createdAt ?? new Date().toISOString(),
  }));
}
