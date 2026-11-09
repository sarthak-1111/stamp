import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import { getPublicPage } from '@/lib/views';
import { SendForm } from './SendForm';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPublicPage(decodeURIComponent(handle)).catch(() => null);
  return { title: page ? `Message ${page.displayName}` : 'Not found' };
}

export default async function SenderPage({ params }: Props) {
  const { handle } = await params;
  const page = await getPublicPage(decodeURIComponent(handle));
  if (!page) notFound();
  const amount = formatMoney(page.holdCents, page.currency);
  const first = page.displayName.split(/\s+/)[0] ?? page.displayName;

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section aria-labelledby="who">
        <p className="eyebrow">@{page.handle}</p>
        <h1 id="who" className="font-display mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Write to {page.displayName}
        </h1>
        {page.bio ? <p className="mt-4 text-lg text-ink-2">{page.bio}</p> : null}
        {page.topics.length ? (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-ink-2">Happy to hear about</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {page.topics.map((t) => (
                <li key={t} className="chip">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="stamp-edge mt-10 max-w-md">
          <div className="rounded-sm border border-line/80 p-5">
            <p className="font-display text-2xl leading-snug font-semibold">
              Your {amount} is held, not charged. <span className="text-good">Real messages get it back.</span>
            </p>
            <dl className="mt-5 grid gap-3 text-[15px]">
              <div className="flex gap-3">
                <dt className="sr-only">If {first} replies or marks it worth it</dt>
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-good" />
                <dd className="text-ink-2">
                  {first} replies or marks it worth it: the hold is <strong className="text-ink">released</strong>. You pay nothing.
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">If nobody acts</dt>
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-held" />
                <dd className="text-ink-2">
                  No decision within <strong className="text-ink">{page.releaseLabel}</strong>: released automatically.
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">If marked as spam</dt>
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-donated" />
                <dd className="text-ink-2">
                  Marked as spam: captured and donated to <strong className="text-ink">{page.charity?.name ?? 'charity'}</strong>.{' '}
                  {first} never receives your money, and neither does Stamp.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="compose" className="card p-5 sm:p-7">
        <h2 id="compose" className="font-display text-2xl font-semibold">
          Your message
        </h2>
        {page.charity ? (
          <SendForm handle={page.handle} amountLabel={amount} firstName={first} hasFreeLane={page.hasFreeLane} />
        ) : (
          <p className="mt-4 text-bad">This page can’t accept messages right now.</p>
        )}
      </section>
    </div>
  );
}
