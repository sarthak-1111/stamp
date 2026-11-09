import { after } from 'next/server';
import { getDb } from '@/lib/db';
import { maybeSweep, refreshHold } from '@/lib/holds/service';
import { errorResponse, json } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { getStatusView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/** Sender status, polled by /s/[token]. Re-verifies with PayPal (throttled) before answering. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!(await takeRateLimit(`status:${clientIpHash(req.headers)}`, LIMITS.status.limit, LIMITS.status.windowSeconds))) {
      return json({ error: 'rate_limited' }, 429);
    }
    const db = await getDb();
    const rows = await db.query<{ id: string }>(
      'SELECT h.id FROM holds h JOIN messages m ON m.id = h.message_id WHERE m.status_token = $1',
      [token],
    );
    if (rows[0]) await refreshHold(rows[0].id);
    const view = await getStatusView(token);
    if (!view) return json({ error: 'not_found' }, 404);
    after(maybeSweep);
    return json(view);
  } catch (err) {
    return errorResponse(err);
  }
}
