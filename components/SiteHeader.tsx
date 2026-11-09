import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { Brand } from './Brand';

export async function SiteHeader() {
  const owner = await currentOwner().catch(() => null);
  return (
    <header className="border-b border-line/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Brand />
          <span className="chip hidden !border-held/30 !bg-held-bg !text-held sm:inline-flex" title="Runs on the PayPal sandbox. No real money moves.">
            Sandbox
          </span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-1 text-[15px] sm:gap-2">
          {owner ? (
            <>
              <Link className="rounded-full px-3 py-2 text-ink-2 hover:bg-paper-2 hover:text-ink" href="/inbox">
                Inbox
              </Link>
              <Link className="rounded-full px-3 py-2 text-ink-2 hover:bg-paper-2 hover:text-ink" href="/ledger">
                Ledger
              </Link>
              <Link className="hidden rounded-full px-3 py-2 text-ink-2 hover:bg-paper-2 hover:text-ink sm:inline" href={`/@${owner.handle}`}>
                @{owner.handle}
              </Link>
            </>
          ) : (
            <>
              <Link className="hidden rounded-full px-3 py-2 text-ink-2 hover:bg-paper-2 hover:text-ink sm:inline" href="/#how">
                How it works
              </Link>
              <Link className="btn btn-ink !min-h-10 !px-4 !py-2 text-sm" href="/setup">
                Create your page
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
