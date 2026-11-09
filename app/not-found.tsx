import Link from 'next/link';
import { Postmark } from '@/components/StateBadge';

export default function NotFound() {
  return (
    <div className="rise mx-auto flex max-w-xl flex-col items-center px-4 pt-20 text-center sm:px-6">
      <Postmark id="not-found" tone="neutral" top="No such address" main="Returned" bottom="Stamp" />
      <h1 className="mt-8 text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">Return to sender</h1>
      <p className="mt-3 text-[17px] leading-7 text-ink-2">There is no page at this address.</p>
      <Link href="/" className="btn btn-secondary mt-8">
        Back home
      </Link>
    </div>
  );
}
