import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { handleApprovalReturn, StampError } from '@/lib/holds/service';

export const dynamic = 'force-dynamic';
// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;

/** PayPal sends the buyer back here after approval (?token=<order id>&PayerID=...). */
export async function GET(req: Request) {
  const base = getConfig().appUrl;
  const orderId = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[A-Z0-9]{5,40}$/i.test(orderId)) return NextResponse.redirect(new URL('/?error=checkout', base), 303);
  try {
    const statusToken = await handleApprovalReturn(orderId);
    return NextResponse.redirect(new URL(`/s/${statusToken}?from=paypal`, base), 303);
  } catch (err) {
    if (!(err instanceof StampError)) console.error('[stamp] return handler failed', err);
    return NextResponse.redirect(new URL('/?error=checkout', base), 303);
  }
}
