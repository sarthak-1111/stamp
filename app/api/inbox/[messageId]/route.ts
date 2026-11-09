import { currentOwner } from '@/lib/auth';
import { recipientDecide } from '@/lib/holds/service';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { ActionSchema } from '@/lib/validation';
import { holdView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/** The recipient's decision: reply / worth_it (release the hold) or spam (capture + donate). */
export async function POST(req: Request, ctx: { params: Promise<{ messageId: string }> }) {
  try {
    assertSameOrigin(req);
    const owner = await currentOwner();
    if (!owner) return json({ error: 'unauthorized', message: 'Open your private inbox link first.' }, 401);
    if (!(await takeRateLimit(`action:${clientIpHash(req.headers)}`, LIMITS.action.limit, LIMITS.action.windowSeconds))) {
      return json({ error: 'rate_limited', message: 'Slow down a little.' }, 429);
    }
    const parsed = ActionSchema.safeParse(await readJson(req));
    if (!parsed.success) return json({ error: 'invalid', message: 'Unknown action.' }, 400);
    const { messageId } = await ctx.params;
    const result = await recipientDecide(owner.id, messageId, parsed.data.action, {
      replyText: parsed.data.replyText ?? null,
      confirm: parsed.data.confirm,
    });
    return json({ lane: result.lane, hold: result.hold ? holdView(result.hold) : null });
  } catch (err) {
    return errorResponse(err);
  }
}
