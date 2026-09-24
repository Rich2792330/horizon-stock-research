/**
 * Shared outbound fetch: timeout, one retry on transient errors,
 * optional fallback URLs. Scoring/analysis is unchanged — this only
 * makes the same inputs more likely to arrive.
 */

const DEFAULT_TIMEOUT_MS = 16_000;
const RETRY_WAIT_MS = 450;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  urls: string | string[],
  init: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    accept?: "json" | "text";
  } = {},
): Promise<{ ok: true; status: number; text: string } | { ok: false; status: number }> {
  const list = Array.isArray(urls) ? urls : [urls];
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    Accept: init.accept === "text" ? "*/*" : "application/json",
    ...(init.headers ?? {}),
  };

  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of list) {
      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = res.status;
        if (res.ok) {
          return { ok: true, status: res.status, text: await res.text() };
        }
        if (!isRetryableStatus(res.status)) {
          return { ok: false, status: res.status };
        }
      } catch {
        lastStatus = 0;
      }
    }
    if (attempt === 0) await sleep(RETRY_WAIT_MS + Math.floor(Math.random() * 250));
  }
  return { ok: false, status: lastStatus };
}

export async function fetchJson<T>(
  urls: string | string[],
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<T | null> {
  const res = await fetchWithRetry(urls, { headers, timeoutMs, accept: "json" });
  if (!res.ok) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}

export async function fetchText(
  urls: string | string[],
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<string | null> {
  const res = await fetchWithRetry(urls, { headers, timeoutMs, accept: "text" });
  return res.ok ? res.text : null;
}
