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
      <div className="rise mx-auto max-w-xl px-4 pt-16 sm:px-6">
        <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">The ledger is private</h1>
        <p className="mt-3 text-[17px] leading-7 text-ink-2">Open your private inbox link first. It signs you in on this device.</p>
        <Link href="/setup" className="btn btn-primary mt-8">
          Create a page
        </Link>
      </div>
    );
  }
  const { rows, events } = await getLedger(owner);
  return (
    <div className="rise mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 sm:pt-12 lg:px-8">
      <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">Ledger</h1>
      <p className="mt-2 max-w-3xl text-[16px] leading-7 text-ink-2">
        Every message to <span className="font-mono text-[15px]">@{owner.handle}</span>, the AI’s suggestion next to the decision you made, and every
        money state as PayPal confirmed it. Select a row to see each PayPal call with its idempotency key.
      </p>
      <LedgerGrid initialRows={rows} initialEvents={events} />
    </div>
  );
}
