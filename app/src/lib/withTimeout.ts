// Startup diagnostics (2026-07-06): the app was hanging forever on cold
// start with a clean Metro bundle and no visible error — a promise
// somewhere in the auth/session bootstrap chain (storage adapter, native
// crypto module, or a stuck Supabase internal lock) was never
// resolving OR rejecting. A bare await has no way to recover from that.
// Every await on the startup path must race against this so a stuck
// promise degrades to "treat as signed out" instead of an infinite
// splash/loading screen. The original promise is not cancelled — it's
// just stopped waiting on — so this is only safe for reads whose result
// can be safely discarded if it eventually does resolve.
// Accepts PromiseLike rather than Promise — supabase-js query builders are
// thenable but not real Promise instances (no .catch/.finally), which is
// exactly the shape being raced here.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[startup] ${label} timed out after ${ms}ms — falling through`);
      resolve(null);
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[startup] ${label} rejected —`, err);
        resolve(null);
      }
    );
  });
}
