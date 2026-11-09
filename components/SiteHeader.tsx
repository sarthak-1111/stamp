import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { Brand } from './Brand';

const navLink = 'rounded-lg px-3 py-2 text-[15px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink';

export async function SiteHeader() {
  const owner = await currentOwner().catch(() => null);
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Brand />
          <span className="tag !px-1.5 !text-[12px] !leading-[18px]" title="Runs on the PayPal sandbox. No real money moves.">
            Sandbox
          </span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-1">
          {owner ? (
            <>
              <Link className={navLink} href="/inbox">
                Inbox
              </Link>
              <Link className={navLink} href="/ledger">
                Ledger
              </Link>
              <Link className={`${navLink} hidden sm:inline-flex`} href="/setup">
                Settings
              </Link>
              <Link className={`${navLink} hidden font-mono !text-[14px] md:inline-flex`} href={`/@${owner.handle}`}>
                @{owner.handle}
              </Link>
            </>
          ) : (
            <>
              <Link className={`${navLink} hidden md:inline-flex`} href="/#how">
                How it works
              </Link>
              <Link className={`${navLink} hidden md:inline-flex`} href="/#agents">
                For agents
              </Link>
              <Link className="btn btn-primary btn-sm ml-2" href="/setup">
                Create your page
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
