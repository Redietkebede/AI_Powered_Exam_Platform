// client/src/lib/api.ts
import { getIdToken, clearToken, setToken } from "../services/authService";
import { getAuth } from "firebase/auth";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export interface RequestOpts {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  /** Optional query params appended to the URL. */
  params?: Record<string, unknown>;
}

const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

function buildUrl(path: string, params?: Record<string, unknown>) {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = `${BASE}${p}`;
  if (!params) return baseUrl;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, String(x)));
    else usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

export async function request<T = unknown>(
  path: string,
  opts: RequestOpts = {}
): Promise<T> {
  const url = buildUrl(path, opts.params);

  async function doFetch(forceRefresh = false): Promise<T> {
    let token: string | null = await getIdToken();

    if (forceRefresh) {
      try {
        const u = getAuth().currentUser;
        token = u ? await u.getIdToken(true) : null;
        if (token) setToken(token);
        else clearToken();
      } catch {
        token = null;
        clearToken();
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const method = (opts.method ?? "GET").toUpperCase();
    const isFormData =
      typeof FormData !== "undefined" && opts.body instanceof FormData;

    // Never send a body for GET/HEAD
    const hasBody = opts.body !== undefined && method !== "GET" && method !== "HEAD";
    let body: BodyInit | undefined;

    if (hasBody) {
      if (!isFormData && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      body = isFormData ? (opts.body as FormData) : JSON.stringify(opts.body);
    }

    const init: RequestInit = {
      method,
      headers,
      credentials: opts.credentials ?? "include",
      signal: opts.signal,
      body,
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (networkErr: any) {
      const err = new Error(networkErr?.message || "Network error") as Error & {
        status: number;
        payload: unknown;
      };
      err.status = 0;
      err.payload = null;
      throw err;
    }

    // Retry once on 401/403, or 400 with auth-ish error message
    if (
      !forceRefresh &&
      (res.status === 401 || res.status === 403 || res.status === 400)
    ) {
      try {
        const ct = res.headers.get("content-type") || "";
        const payload = ct.includes("application/json")
          ? await res.json()
          : await res.text();
        const msg =
          typeof payload === "string"
            ? payload
            : (payload as any)?.error || (payload as any)?.message || "";
        const looksLikeAuth = /unauth|token|expired|invalid/i.test(String(msg));
        if (res.status === 401 || res.status === 403 || looksLikeAuth) {
          return doFetch(true);
        }
      } catch {
        // ignore and fall through
      }
    }

    if (!res.ok) {
      let payload: unknown = null;
      try {
        const ct = res.headers.get("content-type") || "";
        payload = ct.includes("application/json")
          ? await res.json()
          : await res.text();
      } catch {}
      const message =
        (payload &&
          typeof payload === "object" &&
          "message" in (payload as any) &&
          (payload as any).message) ||
        (payload &&
          typeof payload === "object" &&
          "error" in (payload as any) &&
          (payload as any).error) ||
        (typeof payload === "string"
          ? payload
          : `HTTP ${res.status} ${res.statusText}`);
      const err = new Error(String(message)) as Error & {
        status: number;
        payload: unknown;
      };
      err.status = res.status;
      err.payload = payload;
      throw err;
    }

    if (res.status === 204) return undefined as T;

    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) return (await res.json()) as T;
    } catch {
      // ignore parse errors; fall through
    }
    return undefined as T;
  }

  return doFetch(false);
}



export const api = {
  get: <T>(p: string, opts?: Omit<RequestOpts, "method" | "body">) =>
    request<T>(p, { ...(opts || {}), method: "GET" }),
  post: <T>(
    p: string,
    body?: unknown,
    opts?: Omit<RequestOpts, "method" | "body">
  ) => request<T>(p, { ...(opts || {}), method: "POST", body }),
  put: <T>(
    p: string,
    body?: unknown,
    opts?: Omit<RequestOpts, "method" | "body">
  ) => request<T>(p, { ...(opts || {}), method: "PUT", body }),
  patch: <T>(
    p: string,
    body?: unknown,
    opts?: Omit<RequestOpts, "method" | "body">
  ) => request<T>(p, { ...(opts || {}), method: "PATCH", body }),
  del: <T>(p: string, opts?: Omit<RequestOpts, "method" | "body">) =>
    request<T>(p, { ...(opts || {}), method: "DELETE" }),
};
