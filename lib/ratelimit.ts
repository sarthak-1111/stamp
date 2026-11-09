import 'server-only';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { hmac } from '@/lib/ids';

/** Fixed-window counter in Postgres. Returns true if the call is within the limit. */
export async function takeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const db = await getDb();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const rows = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start
     RETURNING count`,
    [key, windowStart],
  );
  return Number(rows[0]?.count ?? 1) <= limit;
}

/** Client IP as seen by the host (Vercel sets x-real-ip / x-forwarded-for), stored only as a keyed hash. */
export function clientIpHash(headers: Headers): string {
  const ip =
    headers.get('x-real-ip') ??
    headers.get('x-vercel-forwarded-for')?.split(',')[0] ??
    headers.get('x-forwarded-for')?.split(',')[0] ??
    'local';
  return hmac(getConfig().sessionSecret, `ip:${ip.trim()}`).slice(0, 22);
}

export const LIMITS = {
  send: { limit: 6, windowSeconds: 600 },
  request: { limit: 3, windowSeconds: 3600 },
  api: { limit: 20, windowSeconds: 600 },
  sendPerPage: { limit: 30, windowSeconds: 3600 },
  setup: { limit: 5, windowSeconds: 3600 },
  status: { limit: 120, windowSeconds: 60 },
  action: { limit: 30, windowSeconds: 60 },
  signin: { limit: 10, windowSeconds: 600 },
  tick: { limit: 4, windowSeconds: 60 },
} as const;
