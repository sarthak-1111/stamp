'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Postmark, StateBadge } from '@/components/StateBadge';
import { AbsoluteTime, Countdown, RelativeTime } from '@/components/Time';
import { formatMoney } from '@/lib/money';
import type { StatusView } from '@/lib/views';

const TERMINAL = new Set(['VOIDED', 'DONATED', 'EXPIRED', 'FAILED']);

function headline(v: StatusView): { title: string; sub: string; postmark: { top: string; main: string } } {
  const h = v.hold;
  const name = v.recipient.displayName.split(/\s+/)[0] ?? v.recipient.displayName;
  if (!h) return { title: 'Delivered on the free lane', sub: `No hold needed: ${name} added you to their free lane.`, postmark: { top: 'Free lane', main: 'Delivered' } };
  const amount = formatMoney(h.amountCents, h.currency);
  if (h.pendingOp === 'void') return { title: 'Releasing your hold…', sub: 'PayPal is voiding the authorization.', postmark: { top: amount, main: 'Releasing' } };
  if (h.pendingOp === 'capture') return { title: 'Marked as spam', sub: `Capturing the hold for ${h.charityName}…`, postmark: { top: amount, main: 'Capturing' } };
  switch (h.state) {
    case 'DRAFT':
      return { title: 'Waiting for your PayPal approval', sub: 'Your message is saved. It is delivered once you approve the hold in PayPal.', postmark: { top: amount, main: 'Not yet' } };
    case 'APPROVED':
      return { title: 'Approved. Placing your hold…', sub: 'PayPal is authorizing the hold.', postmark: { top: amount, main: 'Approved' } };
    case 'AUTHORIZED':
      return { title: `Your ${amount} is held, not charged.`, sub: `Real messages get it back. Your message is in ${name}’s inbox.`, postmark: { top: amount, main: 'Held' } };
    case 'VOIDED':
      return { title: 'Released. You paid nothing.', sub: h.outcomeLabel ?? 'The hold was voided.', postmark: { top: amount, main: 'Released' } };
    case 'CAPTURED':
      return { title: `Marked as spam: captured for ${h.charityName}`, sub: `${name} receives nothing. The donation is on its way through PayPal Payouts.`, postmark: { top: amount, main: 'Captured' } };
    case 'DONATED':
      return {
        title: `${formatMoney(h.donatedCents)} donated to ${h.charityName}`,
        sub: `${name} marked your message as spam. After PayPal’s fee, the rest went to charity. ${name} received nothing.`,
        postmark: { top: amount, main: 'Donated' },
      };
    case 'EXPIRED':
      return { title: 'Not sent. Nothing was held.', sub: h.outcomeLabel ?? 'The PayPal approval was not completed.', postmark: { top: amount, main: 'Not sent' } };
    default:
      return { title: 'That didn’t go through', sub: `${h.outcomeLabel ?? 'PayPal declined.'} Nothing was charged.`, postmark: { top: amount, main: 'Failed' } };
  }
}

export function StatusLive({ initial }: { initial: StatusView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/status/${initial.token}`, { cache: 'no-store' });
      if (res.ok) {
        setView(await res.json());
        setError(false);
      } else if (res.status !== 429) setError(true);
    } catch {
      setError(true);
    }
  }, [initial.token]);

  const done = view.hold ? TERMINAL.has(view.hold.state) && !view.hold.pendingOp : true;

  useEffect(() => {
    if (done) return;
    const tick = async () => {
      await refresh();
      timer.current = setTimeout(tick, 4000);
    };
    timer.current = setTimeout(tick, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [done, refresh]);

  const h = view.hold;
  const head = headline(view);

  return (
    <article aria-labelledby="status-title">
      <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">
            To @{view.recipient.handle} · “{view.subject}”
          </p>
          <h1 id="status-title" className="font-display mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {head.title}
          </h1>
          <p className="mt-3 max-w-xl text-lg text-ink-2">{head.sub}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2" aria-live="polite">
            {h ? <StateBadge tone={h.tone} label={h.stateLabel} busy={!done} /> : <StateBadge tone="good" label="Delivered" />}
            {h?.state === 'AUTHORIZED' && h.releaseAt && !h.pendingOp ? (
              <span className="chip">
                <Countdown until={h.releaseAt} onElapsed={refresh} />
              </span>
            ) : null}
          </div>
        </div>
        <Postmark tone={h?.tone ?? 'good'} top={head.postmark.top} main={head.postmark.main} bottom="Stamp" />
      </div>

      {view.approveUrl ? (
        <div className="mt-6">
          <a className="btn btn-primary" href={view.approveUrl}>
            Continue to PayPal
          </a>
        </div>
      ) : null}

      {h && (h.state === 'EXPIRED' || h.state === 'FAILED') ? (
        <div className="mt-6">
          <Link className="btn btn-ghost" href={`/@${view.recipient.handle}`}>
            Write again
          </Link>
        </div>
      ) : null}

      {view.replyText ? (
        <section aria-labelledby="reply-title" className="card mt-8 p-5 sm:p-6">
          <h2 id="reply-title" className="text-sm font-semibold text-ink-2">
            Reply from {view.recipient.displayName}
          </h2>
          <p className="mt-2 whitespace-pre-wrap">{view.replyText}</p>
        </section>
      ) : null}

      {h && (h.state === 'CAPTURED' || h.state === 'DONATED') && h.feeCents !== null ? (
        <section aria-label="Where the money went" className="card mt-8 grid gap-3 p-5 text-[15px] sm:grid-cols-3 sm:p-6">
          <div>
            <div className="text-ink-3">Captured</div>
            <div className="font-mono text-lg">{formatMoney(h.amountCents)}</div>
          </div>
          <div>
            <div className="text-ink-3">PayPal fee</div>
            <div className="font-mono text-lg">{formatMoney(h.feeCents)}</div>
          </div>
          <div>
            <div className="text-ink-3">{h.state === 'DONATED' ? `Donated to ${h.charityName}` : 'To be donated'}</div>
            <div className="font-mono text-lg text-donated">{formatMoney(h.donatedCents ?? h.netCents)}</div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="timeline-title" className="mt-10">
        <h2 id="timeline-title" className="font-display text-xl font-semibold">
          Timeline
        </h2>
        <ol className="mt-4 border-l border-line pl-6">
          {view.timeline.map((t, i) => (
            <li key={`${t.at}-${i}`} className="relative pb-6 last:pb-0">
              <span
                aria-hidden
                className={`absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-paper ${
                  { neutral: 'bg-ink-3', held: 'bg-held', good: 'bg-good', donated: 'bg-donated', bad: 'bg-bad' }[t.tone]
                }`}
              />
              <p className="font-semibold">{t.title}</p>
              {t.detail ? <p className="text-ink-2">{t.detail}</p> : null}
              <AbsoluteTime iso={t.at} className="text-sm text-ink-3" />
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-8 flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
        {h?.lastVerifiedAt ? (
          <>
            <span aria-hidden>✓</span> Checked with PayPal <RelativeTime iso={h.lastVerifiedAt} />.
          </>
        ) : null}
        {error ? <span className="text-bad">Couldn’t refresh just now; retrying.</span> : null}
        <span>Keep this page’s link to check back later.</span>
      </p>
    </article>
  );
}
