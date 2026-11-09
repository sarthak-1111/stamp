import type { Metadata } from 'next';
import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { getInboxView } from '@/lib/views';
import { InboxClient } from './InboxClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inbox', referrer: 'no-referrer' };

export default async function InboxPage() {
  const owner = await currentOwner();
  if (!owner) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6">
        <div className="card p-6 sm:p-8">
          <h1 className="font-display text-3xl font-semibold">Your inbox is private</h1>
          <p className="mt-3 text-ink-2">
            Open the private inbox link you saved when you created your page. It signs you in on this device. There are no passwords.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/setup" className="btn btn-primary">
              Create a page
            </Link>
            <Link href="/" className="btn btn-ghost">
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const view = await getInboxView(owner);
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
      <InboxClient initial={view} />
    </div>
  );
}
