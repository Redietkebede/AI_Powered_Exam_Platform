// server/src/utils/backoff.ts
export async function with429Retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: any;
  for (let a = 0; a < tries; a++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status ?? 0;
      const details = String(e?.response?.data?.error?.details ?? "");
      if (status === 429) {
        // jittered backoff: 1s, 2s, 4s (+ jitter)
        const ms = 1000 * Math.pow(2, a) + Math.floor(Math.random() * 300);
        await new Promise(r => setTimeout(r, ms));
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("Provider rate-limited (429) after retries.");
}
