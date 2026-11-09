import type { Metadata } from 'next';
import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { getInboxView } from '@/lib/views';
import { InboxClient } from './InboxClient';

export const dynamic = 'force-dynamic';
// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;
export const metadata: Metadata = { title: 'Inbox', referrer: 'no-referrer' };

export default async function InboxPage() {
  const owner = await currentOwner();
  if (!owner) {
    return (
      <div className="rise mx-auto max-w-xl px-4 pt-16 sm:px-6">
        <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">Your inbox is private</h1>
        <p className="mt-3 text-[17px] leading-7 text-ink-2">
          Open the private inbox link you saved when you created your page. It signs you in on this device. There are no passwords.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/setup" className="btn btn-primary">
            Create a page
          </Link>
          <Link href="/" className="btn btn-secondary">
            Back home
          </Link>
        </div>
      </div>
    );
  }
  const view = await getInboxView(owner);
  return (
    <div className="rise mx-auto max-w-[880px] px-4 pt-10 sm:px-6 sm:pt-12">
      <InboxClient initial={view} />
    </div>
  );
}
