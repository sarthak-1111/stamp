import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { handleApprovalCancel } from '@/lib/holds/service';

export const dynamic = 'force-dynamic';

/** The buyer clicked "Cancel and return" on PayPal's page. */
export async function GET(req: Request) {
  const base = getConfig().appUrl;
  const orderId = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[A-Z0-9]{5,40}$/i.test(orderId)) return NextResponse.redirect(new URL('/', base), 303);
  try {
    const statusToken = await handleApprovalCancel(orderId);
    return NextResponse.redirect(new URL(statusToken ? `/s/${statusToken}` : '/', base), 303);
  } catch (err) {
    console.error('[stamp] cancel handler failed', err);
    return NextResponse.redirect(new URL('/', base), 303);
  }
}
