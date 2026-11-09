import 'server-only';
import { NextResponse } from 'next/server';
import { StampError } from '@/lib/holds/service';
import { TransitionError } from '@/lib/holds/machine';

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof StampError) return json({ error: err.code, message: err.message }, err.status);
  if (err instanceof TransitionError) return json({ error: 'not_allowed', message: 'That action is not allowed for this hold.' }, 409);
  console.error('[stamp] unhandled error', err);
  return json({ error: 'internal', message: 'Something went wrong. Nothing was charged.' }, 500);
}

/** CSRF: state-changing browser requests must come from our own origin (cookies are also SameSite=Lax). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    // fall through
  }
  if (!host || originHost !== host) throw new StampError('bad_origin', 'Cross-site request refused.', 403);
}

export async function readJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) throw new StampError('too_large', 'Request too large.', 413);
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
