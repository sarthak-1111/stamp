import { requestFreePass } from '@/lib/holds/service';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { parseRequest } from '@/lib/validation';

export const dynamic = 'force-dynamic';
// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;

/** Ask for a free pass instead of placing a hold. No money moves; the recipient grants or declines. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const ip = clientIpHash(req.headers);
    const parsed = parseRequest(await readJson(req));
    if (!parsed.ok) return json({ error: 'invalid', fields: parsed.errors }, 400);
    if (!(await takeRateLimit(`request:${ip}`, LIMITS.request.limit, LIMITS.request.windowSeconds))) {
      return json({ error: 'rate_limited', message: 'Too many requests from this network. Please try again later.' }, 429);
    }
    const { statusToken } = await requestFreePass(parsed.data, { ipHash: ip });
    return json({ statusUrl: `/s/${statusToken}` }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
