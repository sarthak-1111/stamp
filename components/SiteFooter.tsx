import Link from 'next/link';
import { StampMark } from './Brand';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-sm text-ink-3 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex items-start gap-3">
          <StampMark size={18} />
          <p className="max-w-xl">
            A hackathon demo on the PayPal sandbox. No real money moves. Stamp never pays the recipient: spam holds go to charity.
          </p>
        </div>
        <p className="flex gap-5">
          <Link className="transition-colors hover:text-ink" href="/#fair">
            Fairness
          </Link>
          <Link className="transition-colors hover:text-ink" href="/#agents">
            For agents
          </Link>
          <a className="transition-colors hover:text-ink" href="https://github.com/sarthak-1111/stamp">
            Source, MIT
          </a>
        </p>
      </div>
    </footer>
  );
}
