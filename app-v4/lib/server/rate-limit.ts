// In-memory sliding-window limiter for routes that do not move NEAR but cost money or a write:
// the NEAR AI proxies (/api/intent, /api/transcribe), quotes, and the demo control routes.
//
// Scope, stated plainly: the windows live in one server instance. Vercel reuses warm instances,
// so a loop from one client is throttled, but a burst spread across many cold instances is not
// globally bounded here. Spend that moves NEAR is bounded separately by the durable, CAS-protected
// counters in demo-limits.ts; the model routes' final bound is the provider key's spending limit.

type Window = { hits: number[] };

const windows = new Map<string, Window>();
const MAX_KEYS = 20_000;

export type Limit = { max: number; windowMs: number };

export const ROUTE_LIMITS = {
  intent: [{ max: 20, windowMs: 60_000 }, { max: 300, windowMs: 86_400_000 }],
  transcribe: [{ max: 15, windowMs: 60_000 }, { max: 200, windowMs: 86_400_000 }],
  quote: [{ max: 20, windowMs: 60_000 }],
  control: [{ max: 30, windowMs: 60_000 }],
  /** Per-instance ceiling for all callers together on the paid model routes. */
  modelGlobal: [{ max: 600, windowMs: 3_600_000 }],
} satisfies Record<string, Limit[]>;

function prune(now: number) {
  if (windows.size < MAX_KEYS) return;
  for (const [key, window] of windows) {
    if (!window.hits.length || now - window.hits[window.hits.length - 1] > 86_400_000) windows.delete(key);
    if (windows.size < MAX_KEYS * 0.8) break;
  }
}

/** Records one hit for `key` if every limit allows it. */
export function hit(key: string, limits: Limit[], now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  prune(now);
  const longest = Math.max(...limits.map((limit) => limit.windowMs));
  const window = windows.get(key) ?? { hits: [] };
  window.hits = window.hits.filter((at) => now - at < longest);
  for (const limit of limits) {
    const inWindow = window.hits.filter((at) => now - at < limit.windowMs);
    if (inWindow.length >= limit.max) {
      windows.set(key, window);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0] + limit.windowMs - now) / 1000)) };
    }
  }
  window.hits.push(now);
  windows.set(key, window);
  return { ok: true };
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}

export function tooMany(retryAfterSec: number, message = "Too many requests. Wait a moment and try again."): Response {
  return Response.json({ error: message }, {
    status: 429,
    headers: { "retry-after": String(retryAfterSec), "cache-control": "private, no-store" },
  });
}
