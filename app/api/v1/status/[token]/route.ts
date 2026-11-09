import { getAgentStatus } from '@/lib/agents';
import { apiJson, preflight } from '@/lib/cors';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/** Agent lane: where a stamped message stands, in a compact machine-readable form. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!(await takeRateLimit(`api-read:${clientIpHash(req.headers)}`, LIMITS.status.limit, LIMITS.status.windowSeconds))) {
    return apiJson({ error: 'rate_limited' }, 429);
  }
  const { token } = await ctx.params;
  const status = await getAgentStatus(token).catch(() => null);
  return status ? apiJson(status) : apiJson({ error: 'not_found' }, 404);
}
