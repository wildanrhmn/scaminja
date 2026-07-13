import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  maxPerIp: number;
  maxGlobal: number;
}

// Fixed-window per-IP + global caps (the global cap bounds total Claude spend in
// open mode). In-memory; needs `trust proxy` so req.ip is the real client.
export function rateLimiter(opts: RateLimitOptions) {
  const perIp = new Map<string, Bucket>();
  const global: Bucket = { count: 0, resetAt: 0 };

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of perIp) if (b.resetAt <= now) perIp.delete(ip);
  }, opts.windowMs);
  timer.unref?.();

  const roll = (b: Bucket, now: number, max: number): { ok: boolean; retryAfter: number } => {
    if (now >= b.resetAt) {
      b.count = 0;
      b.resetAt = now + opts.windowMs;
    }
    if (b.count >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    b.count++;
    return { ok: true, retryAfter: 0 };
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    let b = perIp.get(ip);
    if (!b) {
      b = { count: 0, resetAt: now + opts.windowMs };
      perIp.set(ip, b);
    }

    const ipCheck = roll(b, now, opts.maxPerIp);
    if (!ipCheck.ok) {
      res.setHeader("Retry-After", String(ipCheck.retryAfter));
      return res.status(429).json({ error: "You're checking a lot in a short time — give it a few seconds and try again.", retry_after_seconds: ipCheck.retryAfter });
    }

    // Only count global once the IP passes, so one flooder can't lock everyone out.
    const gCheck = roll(global, now, opts.maxGlobal);
    if (!gCheck.ok) {
      res.setHeader("Retry-After", String(gCheck.retryAfter));
      return res.status(503).json({ error: "The free demo is busy right now. Please try again in a minute.", retry_after_seconds: gCheck.retryAfter });
    }

    next();
  };
}

// Hard daily cap on the FREE demo so a bad day can't run away with the Claude
// balance. Rolls 24h from the first call of a window. When exhausted it returns a
// distinct `limit_reached` flag so the website can lock the UI + show a clear note.
// Paid x402 callers never pass through this (they cover their own cost).
const DAY_MS = 86_400_000;
export function dailyBudget(opts: { max: number }) {
  const bucket: Bucket = { count: 0, resetAt: 0 };
  return (_req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + DAY_MS;
    }
    if (bucket.count >= opts.max) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({
        error: `The free demo has reached today's limit. It resets in about ${Math.max(1, Math.round(retry / 3600))}h — for unlimited checks, agents can call the paid API at 0.02 USDT per request.`,
        limit_reached: true,
        retry_after_seconds: retry,
      });
    }
    bucket.count++;
    next();
  };
}
