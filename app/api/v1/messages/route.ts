import { agentSend, apiError, parseAgentSend } from '@/lib/agents';
import { apiJson, preflight } from '@/lib/cors';
import { readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/**
 * Agent lane: send a stamped message. Same rules as the web form. Returns PayPal's approval link, which a
 * person must open; the message is delivered only after they approve the hold.
 */
export async function POST(req: Request) {
  try {
    const ip = clientIpHash(req.headers);
    const parsed = parseAgentSend(await readJson(req));
    if (!parsed.ok) return apiJson({ error: 'invalid', fields: parsed.errors }, 400);
    const okIp = await takeRateLimit(`api:${ip}`, LIMITS.api.limit, LIMITS.api.windowSeconds);
    const okPage = await takeRateLimit(`send-page:${parsed.data.handle}`, LIMITS.sendPerPage.limit, LIMITS.sendPerPage.windowSeconds);
    if (!okIp || !okPage) return apiJson({ error: 'rate_limited', message: 'Too many messages right now. Try again in a few minutes.' }, 429);
    return apiJson(await agentSend(parsed.data, 'api', ip), 201);
  } catch (err) {
    const e = apiError(err);
    return apiJson(e.body, e.status);
  }
}
