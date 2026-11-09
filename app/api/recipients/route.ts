import { currentOwner, setOwnerCookie } from '@/lib/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/http';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';
import { createRecipient, getRecipientByHandle, updateRecipient } from '@/lib/recipients';
import { parseHandle, parseSettings } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Handle availability (used by the setup form). */
export async function GET(req: Request) {
  try {
    const handle = parseHandle(new URL(req.url).searchParams.get('handle'));
    if (!handle.ok) return json({ available: false, reason: handle.error });
    const taken = await getRecipientByHandle(handle.handle);
    return json({ available: !taken, reason: taken ? 'That handle is taken.' : null });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create a Stamp page. Returns the private owner key once and sets it as an httpOnly cookie. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    if (!(await takeRateLimit(`setup:${clientIpHash(req.headers)}`, LIMITS.setup.limit, LIMITS.setup.windowSeconds))) {
      return json({ error: 'rate_limited', message: 'Too many pages created from this network. Try again later.' }, 429);
    }
    const body = await readJson(req);
    const handle = parseHandle(body?.handle);
    const settings = parseSettings(body);
    if (!handle.ok || !settings.ok) {
      return json({ error: 'invalid', fields: { ...(handle.ok ? {} : { handle: handle.error }), ...(settings.ok ? {} : settings.errors) } }, 400);
    }
    const created = await createRecipient(handle.handle, settings.data);
    if (!created) return json({ error: 'invalid', fields: { handle: 'That handle is taken.' } }, 409);
    await setOwnerCookie(created.ownerKey);
    return json({ handle: created.recipient.handle, ownerKey: created.ownerKey }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Update the signed-in recipient's settings. */
export async function PUT(req: Request) {
  try {
    assertSameOrigin(req);
    const owner = await currentOwner();
    if (!owner) return json({ error: 'unauthorized', message: 'Open your private inbox link first.' }, 401);
    const settings = parseSettings(await readJson(req));
    if (!settings.ok) return json({ error: 'invalid', fields: settings.errors }, 400);
    const updated = await updateRecipient(owner.id, settings.data);
    return json({ handle: updated?.handle });
  } catch (err) {
    return errorResponse(err);
  }
}
