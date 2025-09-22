import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { request } from "../../lib/api";
import { updateAssignmentSvc } from "../../services/assignmentService";

type AnyRow = Record<string, any>;

/* --------------------------- Row pickers / helpers --------------------------- */

function pickRow(row: AnyRow | null): {
  id: string | null;
  userName: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalQuestions: number | null;
} {
  if (!row) {
    return { id: null, userName: "", startedAt: null, finishedAt: null, totalQuestions: null };
  }
  const id =
    row.id ?? row.sessionId ?? row.session_id ?? row.session?.id ?? null;

  const userName =
    row.candidate_name ?? row.candidate ?? row.user_name ?? row.user?.name ?? "";

  const startedAt =
    row.started_at ?? row.startedAt ?? row.session?.started_at ?? null;

  const finishedAt =
    row.finished_at ?? row.finishedAt ?? row.session?.finished_at ?? null;

  const totalQuestions =
    row.total_questions ?? row.totalQuestions ?? row.session?.total_questions ?? null;

  return {
    id: id != null ? String(id) : null,
    userName: String(userName || ""),
    startedAt,
    finishedAt,
    totalQuestions: totalQuestions != null ? Number(totalQuestions) : null,
  };
}

function firstRowLike(res: any): AnyRow | null {
  if (!res) return null;
  if (Array.isArray(res)) return res[0] ?? null;
  if (Array.isArray(res.items)) return res.items[0] ?? null;
  if (Array.isArray(res.data)) return res.data[0] ?? null;
  if (res.data && typeof res.data === "object") return res.data as AnyRow;
  return res as AnyRow;
}

/* --------------------------------- Page ---------------------------------- */

export default function SessionDetailPage() {
  const { sessionId } = useParams();

  const [data, setData] = useState<AnyRow | null>(null);
  const [err, setErr] = useState<string>("");

  // edit state
  const [editing, setEditing] = useState(false);
  const [totalQEdit, setTotalQEdit] = useState<string>("");
  const [finishNow, setFinishNow] = useState(false);
  const [saving, setSaving] = useState(false);

  // single loader that tries multiple common endpoints
  async function loadOnce(): Promise<void> {
    setErr("");
    const endpoints = [
      `/assignments/${sessionId}`,      // our preferred route
      `/exam-sessions/${sessionId}`,    // fallback if present
      `/sessions/${sessionId}`,         // another fallback shape
    ];

    for (const url of endpoints) {
      try {
        const res = await request(url, { method: "GET" });
        const row = firstRowLike(res);
        if (row) {
          setData(row);
          // seed editor with current values
          const picked = pickRow(row);
          setTotalQEdit(
            picked.totalQuestions != null ? String(picked.totalQuestions) : ""
          );
          return;
        }
      } catch {
        // try next endpoint
      }
    }
    // if all failed:
    setErr("Session not found.");
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadOnce();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const s = useMemo(() => pickRow(data), [data]);

  async function reload() {
    await loadOnce();
  }

  async function saveEdits() {
    setSaving(true);
    try {
      const patch: { totalQuestions?: number; finishNow?: boolean } = {};

      const n = Number(totalQEdit);
      if (Number.isFinite(n) && n > 0) patch.totalQuestions = n;
      if (finishNow) patch.finishNow = true;

      if (!("totalQuestions" in patch) && !("finishNow" in patch)) {
        // nothing to change
        setEditing(false);
        setSaving(false);
        return;
      }

      await updateAssignmentSvc(sessionId!, patch);
      await reload();
      setEditing(false);
      setFinishNow(false);
    } catch (e: any) {
      alert(e?.error || e?.message || "Failed to update session");
    } finally {
      setSaving(false);
    }
  }

  if (err) {
    return (
      <div className="m-6 rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 text-lg font-semibold text-[#0f2744]">
          Session #{sessionId}
        </div>
        <div className="text-sm text-rose-600">{err}</div>
        <div className="mt-4">
          <Link to="/app/assignments" className="text-sm text-blue-600 hover:underline">
            ← Back to assignments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="m-6 rounded-xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-lg font-semibold text-[#0f2744]">
          Session #{s.id ?? sessionId}
        </div>
        <div className="flex items-center gap-4">
          {!s.finishedAt && (
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-sm text-blue-600 hover:underline"
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
          )}
          <Link to="/app/assignments" className="text-sm text-blue-600 hover:underline">
            ← Back to assignments
          </Link>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-600">Total questions</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={totalQEdit}
                onChange={(e) => setTotalQEdit(e.target.value.replace(/[^0-9]/g, ""))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <label className="mt-6 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-gray-600"
                checked={finishNow}
                disabled={Boolean(s.finishedAt)}
                onChange={(e) => setFinishNow(e.target.checked)}
              />
              Mark as finished now
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="rounded-md bg-[#ff7a59] px-3 py-2 text-sm text-white hover:brightness-110 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Candidate</div>
          <div className="text-sm font-medium text-[#0f2744]">
            {s.userName || "—"}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Total questions</div>
          <div className="text-sm font-medium text-[#0f2744]">
            {s.totalQuestions ?? "—"}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Started at</div>
          <div className="text-sm font-medium text-[#0f2744]">
            {s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">Finished at</div>
          <div className="text-sm font-medium text-[#0f2744]">
            {s.finishedAt ? new Date(s.finishedAt).toLocaleString() : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
