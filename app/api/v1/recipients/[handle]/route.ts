import { getTerms } from '@/lib/agents';
import { apiJson, preflight } from '@/lib/cors';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/** Agent lane: the terms of a Stamp page (price, release window, charity, return rate). */
export async function GET(req: Request, ctx: { params: Promise<{ handle: string }> }) {
  if (!(await takeRateLimit(`api-read:${clientIpHash(req.headers)}`, LIMITS.status.limit, LIMITS.status.windowSeconds))) {
    return apiJson({ error: 'rate_limited' }, 429);
  }
  const { handle } = await ctx.params;
  const terms = await getTerms(decodeURIComponent(handle).replace(/^@/, '').toLowerCase()).catch(() => null);
  return terms ? apiJson(terms) : apiJson({ error: 'not_found', message: 'There is no Stamp page with that handle.' }, 404);
}
