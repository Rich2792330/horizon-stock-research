/**
 * In-memory TTL cache with in-flight promise deduplication.
 * Shared across concurrent ticker analyses (SPY/VIX/SEC/social).
 */

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Soft cap so long scans cannot grow unbounded in one process */
const MAX_ENTRIES = 480;

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, e] of store) {
    if (e.expires <= now) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next().value as string | undefined;
    if (first == null) break;
    store.delete(first);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  evictIfNeeded();
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export interface CachedOpts<T> {
  /** Return false to keep a short miss TTL (do not lock in a failed fetch) */
  persist?: (value: T) => boolean;
  missTtlMs?: number;
}

/** Fetch-or-reuse with TTL and single-flight coalescing */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts?: CachedOpts<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = (async () => {
    try {
      const value = await fn();
      const keep = opts?.persist ? opts.persist(value) : true;
      cacheSet(key, value, keep ? ttlMs : (opts?.missTtlMs ?? 8_000));
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Drop one key so a rate-limit miss can be retried. */
export function cacheDelete(key: string): void {
  store.delete(key);
  inflight.delete(key);
}

/** Clear all (tests / memory pressure) */
export function cacheClear(): void {
  store.clear();
  inflight.clear();
}

// TTLs tuned for live desk vs external rate limits
export const TTL = {
  chart: 90_000, // 90s — prices move; multi-ticker batch shares SPY/VIX
  chartLong: 5 * 60_000, // 5m for 2y history in backtest
  meta: 10 * 60_000,
  news: 3 * 60_000,
  social: 3 * 60_000,
  governance: 15 * 60_000,
  companyfacts: 30 * 60_000,
  cikMap: 24 * 60 * 60_000,
} as const;
