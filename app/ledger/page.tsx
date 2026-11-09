import type { Metadata } from 'next';
import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { getLedger } from '@/lib/views';
import { LedgerGrid } from './LedgerGrid';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ledger', referrer: 'no-referrer' };

export default async function LedgerPage() {
  const owner = await currentOwner();
  if (!owner) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6">
        <div className="card p-6 sm:p-8">
          <h1 className="font-display text-3xl font-semibold">The ledger is private</h1>
          <p className="mt-3 text-ink-2">Open your private inbox link first.</p>
          <Link href="/setup" className="btn btn-primary mt-6">
            Create a page
          </Link>
        </div>
      </div>
    );
  }
  const { rows, events } = await getLedger(owner);
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <p className="eyebrow">Ledger · @{owner.handle}</p>
      <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight">Every hold, every decision</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Each row is one message. The AI’s suggestion sits next to the decision that was actually made, and every money state was confirmed by
        PayPal. The event log shows each PayPal call with its idempotency key.
      </p>
      <LedgerGrid rows={rows} events={events} />
    </div>
  );
}
