import { clearOwnerCookie, setOwnerCookie } from '@/lib/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { verifyOwnerKey } from '@/lib/recipients';

export const dynamic = 'force-dynamic';

/** Sign in with the private owner key (sent from the URL fragment by /signin). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    if (!(await takeRateLimit(`signin:${clientIpHash(req.headers)}`, LIMITS.signin.limit, LIMITS.signin.windowSeconds))) {
      return json({ error: 'rate_limited', message: 'Too many attempts. Try again later.' }, 429);
    }
    const body = await readJson(req);
    const key = typeof body?.key === 'string' ? body.key : '';
    const recipient = await verifyOwnerKey(key);
    if (!recipient) return json({ error: 'invalid_key', message: 'That private link is not valid.' }, 401);
    await setOwnerCookie(key);
    return json({ handle: recipient.handle });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    await clearOwnerCookie();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
