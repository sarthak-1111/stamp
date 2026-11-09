import { sendMessage } from '@/lib/holds/service';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { parseSend } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** A stranger sends a message. Free lane: delivered now. Otherwise: returns PayPal's approval link. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const ip = clientIpHash(req.headers);
    const parsed = parseSend(await readJson(req));
    if (!parsed.ok) return json({ error: 'invalid', fields: parsed.errors }, 400);
    const okIp = await takeRateLimit(`send:${ip}`, LIMITS.send.limit, LIMITS.send.windowSeconds);
    const okPage = await takeRateLimit(`send-page:${parsed.data.handle}`, LIMITS.sendPerPage.limit, LIMITS.sendPerPage.windowSeconds);
    if (!okIp || !okPage) return json({ error: 'rate_limited', message: 'Too many messages right now. Please try again in a few minutes.' }, 429);
    const result = await sendMessage(parsed.data, { ipHash: ip });
    return json({ lane: result.lane, statusUrl: `/s/${result.statusToken}`, approveUrl: result.lane === 'hold' ? result.approveUrl : null }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
