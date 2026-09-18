import { NextRequest } from "next/server";

/**
 * Minimal fixed-window rate limiter, keyed by client IP.
 *
 * Every API route used to be completely unmetered, which mattered most on
 * POST /api/swaps: each call could pin a serverless function for up to 60s
 * polling Circle, insert a database row, and spend the relayer's gas. This
 * puts a ceiling on all of that.
 *
 * Deliberately in-process: state lives in one instance's memory, so with
 * several instances the effective limit is (limit × instances) and a cold
 * start resets the window. That is the right trade for a first line of
 * defence — it needs no extra infrastructure and cannot itself fail open on
 * a network error. It is NOT a substitute for a shared limiter (Redis, or
 * the platform's own edge limiter) once this runs on more than one instance,
 * and it does nothing against a distributed source.
 */
type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/** Bound the map so a flood of distinct IPs can't grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export function clientKey(req: NextRequest): string {
  // x-forwarded-for is attacker-controllable in general, but on Vercel (and
  // behind any sane proxy) the leftmost entry is the real client. Falls back
  // to a single shared bucket, which fails closed rather than open.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Consume one token. Returns true when the request is allowed.
 *
 * @param scope separate limits per route
 * @param limit requests allowed per window
 * @param windowMs window length
 */
export function rateLimit(req: NextRequest, scope: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_KEYS) sweep(now);

  const key = `${scope}:${clientKey(req)}`;
  const window = buckets.get(key);

  if (!window || window.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (window.count >= limit) return false;
  window.count++;
  return true;
}
