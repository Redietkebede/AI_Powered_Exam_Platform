import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { request } from "../lib/api";
import type { User } from "./userService";

let tokenCache: string | null = null;

// --- Token helpers -----------------------------------------------------------
export function setToken(token: string | null): void {
  tokenCache = token;
}

export function clearToken(): void {
  tokenCache = null;
}

export async function getIdToken(): Promise<string | null> {
  if (tokenCache) return tokenCache;
  const user = getAuth().currentUser;
  if (!user) return null;
  const t = await user.getIdToken(); // no forced refresh
  tokenCache = t;
  return t;
}

// Reset the cache when auth state changes (prevents stale tokens)
onAuthStateChanged(getAuth(), () => {
  tokenCache = null;
});

// Small helper to attach Bearer token if present
async function buildAuthHeaders(): Promise<Record<string, string>> {
  const t = await getIdToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// --- API methods -------------------------------------------------------------
/**
 * Fetch the current signed-in user from your backend.
 * Returns null on 401/403 (not logged in).
 * Switch to "/users/me" if that's your endpoint.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const headers = await buildAuthHeaders();
    const me = await request("/auth/me", { headers });
    return me as User;
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) return null;
    throw err;
  }
}

/**
 * Log out from server (if supported) and Firebase.
 * Safe even if /auth/logout doesn't exist.
 */
export async function logout(): Promise<void> {
  try {
    const headers = await buildAuthHeaders();
    await request("/auth/logout", { method: "POST", headers });
  } catch {
    // ignore – some backends don't expose /auth/logout
  } finally {
    await signOut(getAuth());
    clearToken();
    try {
      localStorage.removeItem("user");
      localStorage.removeItem("idToken");
    } catch {
      /* noop */
    }
  }
}

export async function debugPrintIdToken(force = false) {
  const u = getAuth().currentUser;
  if (!u) {
    console.warn("No currentUser. Log in first.");
    return null;
  }
  const t = await u.getIdToken(force);
  console.log("ID_TOKEN:", t);
  return t;
}

if (import.meta.env.DEV) {
  // @ts-ignore
  (window as any).debugPrintIdToken = debugPrintIdToken;
}