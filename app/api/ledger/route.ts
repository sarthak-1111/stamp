import { after } from 'next/server';
import { currentOwner } from '@/lib/auth';
import { maybeSweep } from '@/lib/holds/service';
import { errorResponse, json } from '@/lib/http';
import { getLedger } from '@/lib/views';

export const dynamic = 'force-dynamic';
// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;

/** Polled by the ledger grid for live delta updates. */
export async function GET() {
  try {
    const owner = await currentOwner();
    if (!owner) return json({ error: 'unauthorized' }, 401);
    const ledger = await getLedger(owner);
    after(() => maybeSweep());
    return json(ledger);
  } catch (err) {
    return errorResponse(err);
  }
}
