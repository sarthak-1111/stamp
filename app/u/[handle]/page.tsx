import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HoldStamp, TONE_DOT } from '@/components/StateBadge';
import { RETURN_RATE_MIN_DECIDED } from '@/lib/copy';
import { stampAmount } from '@/lib/money';
import { getPublicPage } from '@/lib/views';
import { SendForm } from './SendForm';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPublicPage(decodeURIComponent(handle)).catch(() => null);
  return { title: page ? `Write to ${page.displayName}` : 'Not found' };
}

export default async function SenderPage({ params }: Props) {
  const { handle } = await params;
  const page = await getPublicPage(decodeURIComponent(handle));
  if (!page) notFound();
  const amount = stampAmount(page.holdCents, page.currency);
  const first = page.displayName.split(/\s+/)[0] ?? page.displayName;
  const r = page.returns;

  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:px-8 lg:pt-16">
      <section aria-labelledby="who" className="rise">
        <p className="font-mono text-[13px] text-ink-3">@{page.handle}</p>
        <h1 id="who" className="mt-2 text-[36px] leading-[1.1] font-medium tracking-[-0.02em] text-balance break-words sm:text-[44px]">
          Write to {page.displayName}
        </h1>
        {page.bio ? <p className="mt-4 text-[17px] leading-7 break-words text-ink-2">{page.bio}</p> : null}
        {page.topics.length ? (
          <div className="mt-6">
            <h2 className="text-[13px] leading-5 text-ink-3">Happy to hear about</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {page.topics.map((t) => (
                <li key={t} className="tag">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section aria-labelledby="terms" className="mt-10 rounded-2xl border border-line bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="terms" className="text-[18px] leading-7 font-medium text-balance">
              Your {amount} is held, not charged. Real messages get it back
            </h2>
            <HoldStamp cents={page.holdCents} currency={page.currency} size="lg" className="shrink-0 rotate-[4deg]" />
          </div>
          <ul className="mt-5 grid gap-4 text-[15px] leading-6">
            <li className="grid grid-cols-[12px_1fr] gap-3">
              <span aria-hidden className={`mt-2 size-2 rounded-full ${TONE_DOT.good}`} />
              <span className="text-ink-2">
                {first} replies or marks it worth it: <span className="text-ink">released, you pay nothing</span>
              </span>
            </li>
            <li className="grid grid-cols-[12px_1fr] gap-3">
              <span aria-hidden className={`mt-2 size-2 rounded-full ${TONE_DOT.good}`} />
              <span className="text-ink-2">
                No decision within {page.releaseLabel}: <span className="text-ink">released automatically</span>
              </span>
            </li>
            <li className="grid grid-cols-[12px_1fr] gap-3">
              <span aria-hidden className={`mt-2 size-2 rounded-full ${TONE_DOT.donated}`} />
              <span className="text-ink-2">
                Marked as spam: <span className="text-ink">donated to {page.charity?.name ?? 'charity'}</span>, after PayPal’s fee. {first} never
                receives it, and neither does Stamp. You will see the reason.
              </span>
            </li>
          </ul>
          <p className="mt-6 border-t border-line pt-4 text-[14px] leading-6 text-ink-3">
            {r.rate !== null ? (
              <>
                {first} has returned <span className="font-mono text-ink tabular-nums">{r.returned}</span> of{' '}
                <span className="font-mono text-ink tabular-nums">{r.decided}</span> decided holds (
                <span className="font-mono text-ink tabular-nums">{r.rate}%</span>).
              </>
            ) : (
              <>A return rate appears here after {RETURN_RATE_MIN_DECIDED} decided holds, so you can judge how this page treats senders.</>
            )}
          </p>
        </section>
      </section>

      <section aria-labelledby="compose" className="rise card p-5 [--i:2] sm:p-8">
        {page.charity ? (
          <SendForm handle={page.handle} amountLabel={amount} firstName={first} hasFreeLane={page.hasFreeLane} />
        ) : (
          <>
            <h2 id="compose" className="text-[20px] font-medium">
              Your message
            </h2>
            <p className="mt-4 text-bad">This page cannot accept messages right now. Try again later.</p>
          </>
        )}
      </section>
    </div>
  );
}
