import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-xl">
          Stamp is a hackathon demo running on the <strong className="font-semibold text-ink-2">PayPal sandbox</strong>. No real money moves.
          Stamp never pays the recipient.
        </p>
        <p className="flex gap-4">
          <Link className="underline-offset-4 hover:underline" href="/#fair">
            Fairness
          </Link>
          <a className="underline-offset-4 hover:underline" href="https://github.com/sarthak-1111/stamp">
            Source (MIT)
          </a>
        </p>
      </div>
    </footer>
  );
}
