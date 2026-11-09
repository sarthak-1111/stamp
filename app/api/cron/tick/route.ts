import { getConfig } from '@/lib/config';
import { safeEqual } from '@/lib/ids';
import { sweep } from '@/lib/holds/service';
import { errorResponse, json } from '@/lib/http';
import { LIMITS, takeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The timer. Called by a scheduler (GitHub Actions every 5 minutes, Vercel Cron daily) and lazily by
 * pages people are looking at. It only does what is already due (auto-release, finishing in-flight
 * operations), so it is safe to call publicly; without the CRON_SECRET it is rate-limited.
 */
async function tick(req: Request) {
  try {
    const { cronSecret } = getConfig();
    const auth = req.headers.get('authorization') ?? '';
    const trusted = Boolean(cronSecret) && safeEqual(auth, `Bearer ${cronSecret}`);
    if (!trusted && !(await takeRateLimit('tick:public', LIMITS.tick.limit, LIMITS.tick.windowSeconds))) {
      return json({ ok: true, skipped: 'rate_limited' });
    }
    const summary = await sweep(trusted ? 25 : 10);
    return json({ ok: true, ...summary, at: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = tick;
export const POST = tick;
