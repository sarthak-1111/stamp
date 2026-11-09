'use client';

import { CheckCircle } from '@phosphor-icons/react';
import { AnimatePresence, m } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EASE } from '@/components/Motion';
import { HoldStamp, Postmark, StateBadge, TONE_DOT } from '@/components/StateBadge';
import { AbsoluteTime, Countdown, RelativeTime } from '@/components/Time';
import { formatMoney, stampAmount } from '@/lib/money';
import type { StatusView } from '@/lib/views';

const TERMINAL = new Set(['VOIDED', 'DONATED', 'EXPIRED', 'FAILED']);
const ICON = { size: 16, weight: 'bold' } as const;

type Head = { title: string; sub: string; mark: string; tone: 'neutral' | 'held' | 'good' | 'donated' | 'bad' };

function headline(v: StatusView): Head {
  const h = v.hold;
  const name = v.recipient.displayName.split(/\s+/)[0] ?? v.recipient.displayName;
  if (v.lane === 'request') {
    if (v.decision === 'grant') return { title: 'Free pass granted', sub: `${name} added your address to their free lane. Write again from the same address and it skips the hold.`, mark: 'Granted', tone: 'good' };
    if (v.decision === 'decline') return { title: 'No free pass this time', sub: `${name} did not grant a free pass. You can still write with a refundable hold.`, mark: 'Declined', tone: 'neutral' };
    return { title: 'Free pass requested', sub: `${name} will see your request. Nothing was held or charged.`, mark: 'Requested', tone: 'neutral' };
  }
  if (!h) return { title: 'Delivered on the free lane', sub: `No hold needed: ${name} added you to their free lane.`, mark: 'Delivered', tone: 'good' };
  const amount = stampAmount(h.amountCents, h.currency);
  if (h.pendingOp === 'void') return { title: 'Releasing your hold', sub: 'PayPal is voiding the authorization.', mark: 'Releasing', tone: 'good' };
  if (h.pendingOp === 'capture') return { title: 'Marked as spam', sub: `Capturing the hold for ${h.charityName}.`, mark: 'Captured', tone: 'donated' };
  switch (h.state) {
    case 'DRAFT':
      return { title: 'Waiting for your PayPal approval', sub: 'Your message is saved. It is delivered once you approve the hold in PayPal.', mark: 'Not yet', tone: 'neutral' };
    case 'APPROVED':
      return { title: 'Approved, placing your hold', sub: 'PayPal is authorizing the hold.', mark: 'Approved', tone: 'neutral' };
    case 'AUTHORIZED':
      return { title: `Your ${amount} is held, not charged`, sub: `Real messages get it back. Your message is in ${name}’s inbox.`, mark: 'Held', tone: 'held' };
    case 'VOIDED':
      return { title: 'Released. You paid nothing', sub: h.outcomeLabel ? `${h.outcomeLabel}.` : 'The hold was voided.', mark: 'Released', tone: 'good' };
    case 'CAPTURED':
      return { title: `Marked as spam, captured for ${h.charityName}`, sub: `${name} receives nothing. The donation is on its way through PayPal Payouts.`, mark: 'Captured', tone: 'donated' };
    case 'DONATED':
      return {
        title: `${formatMoney(h.donatedCents)} donated to ${h.charityName}`,
        sub: `${name} marked your message as spam. After PayPal’s fee, the rest went to charity. ${name} received nothing.`,
        mark: 'Donated',
        tone: 'donated',
      };
    case 'EXPIRED':
      return { title: 'Not sent. Nothing was held', sub: h.outcomeLabel ? `${h.outcomeLabel}.` : 'The PayPal approval was not completed.', mark: 'Not sent', tone: 'neutral' };
    default:
      return { title: 'That did not go through', sub: `${h.outcomeLabel ?? 'PayPal declined'}. Nothing was charged.`, mark: 'Failed', tone: 'bad' };
  }
}

function postmarkDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
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

  const done = view.hold ? TERMINAL.has(view.hold.state) && !view.hold.pendingOp : view.lane !== 'request' || Boolean(view.decision);

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
  const lastAt = view.timeline.at(-1)?.at ?? view.createdAt;

  return (
    <article aria-labelledby="status-title">
      <div className="flex flex-col-reverse gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] leading-5 text-ink-3">
            To <span className="font-mono">@{view.recipient.handle}</span> · {view.subject}
          </p>
          <h1 id="status-title" className="mt-3 text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
            {head.title}
          </h1>
          <p className="mt-3 max-w-xl text-[17px] leading-7 text-ink-2">{head.sub}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3" aria-live="polite">
            {h ? <HoldStamp cents={h.amountCents} currency={h.currency} /> : null}
            {h ? <StateBadge tone={h.tone} label={h.stateLabel} live={!done} /> : <StateBadge tone={head.tone} label={head.mark} live={!done} />}
            {h?.state === 'AUTHORIZED' && h.releaseAt && !h.pendingOp ? (
              <span className="font-mono text-[13px] text-ink-3">
                <Countdown until={h.releaseAt} onElapsed={refresh} />
              </span>
            ) : null}
          </div>
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div
            key={head.mark}
            className="self-center sm:self-start"
            initial={{ opacity: 0, scale: 1.12, rotate: -14 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <Postmark id="status-postmark" tone={head.tone} top={h ? `${stampAmount(h.amountCents, h.currency)} hold` : 'No hold'} main={head.mark} bottom="Stamp sandbox" date={postmarkDate(lastAt)} />
          </m.div>
        </AnimatePresence>
      </div>

      {view.approveUrl ? (
        <div className="mt-8">
          <a className="btn btn-primary btn-lg" href={view.approveUrl}>
            Continue to PayPal
          </a>
        </div>
      ) : null}

      {(h && (h.state === 'EXPIRED' || h.state === 'FAILED')) || (view.lane === 'request' && view.decision) ? (
        <div className="mt-8">
          <Link className="btn btn-secondary" href={`/@${view.recipient.handle}`}>
            {view.decision === 'grant' ? `Write to @${view.recipient.handle}` : 'Write again'}
          </Link>
        </div>
      ) : null}

      {view.decisionReason ? (
        <section aria-labelledby="reason-title" className="mt-10 rounded-2xl border border-line bg-card p-5 sm:p-6">
          <h2 id="reason-title" className="text-[14px] leading-5 text-ink-3">
            Reason given
          </h2>
          <p className="mt-1 text-[17px] leading-7">{view.decisionReason}</p>
        </section>
      ) : null}

      {view.replyText ? (
        <section aria-labelledby="reply-title" className="mt-10 rounded-2xl border border-line bg-card p-5 sm:p-6">
          <h2 id="reply-title" className="text-[14px] leading-5 text-ink-3">
            Reply from {view.recipient.displayName}
          </h2>
          <p className="mt-2 text-[16px] leading-7 whitespace-pre-wrap">{view.replyText}</p>
        </section>
      ) : null}

      {h && (h.state === 'CAPTURED' || h.state === 'DONATED') && h.feeCents !== null ? (
        <section aria-label="Where the money went" className="mt-10 grid grid-cols-1 overflow-hidden rounded-2xl border border-line bg-line [gap:1px] sm:grid-cols-3">
          {[
            ['Captured', formatMoney(h.amountCents), 'text-ink'],
            ['PayPal fee', formatMoney(h.feeCents), 'text-ink'],
            [h.state === 'DONATED' ? `Donated to ${h.charityName}` : 'To be donated', formatMoney(h.donatedCents ?? h.netCents), 'text-donated'],
          ].map(([k, v, tone]) => (
            <div key={k} className="bg-card p-5">
              <div className="text-[14px] leading-5 text-ink-3">{k}</div>
              <div className={`mt-1 font-mono text-[24px] leading-8 tabular-nums ${tone}`}>{v}</div>
            </div>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="timeline-title" className="mt-12">
        <h2 id="timeline-title" className="text-[20px] leading-7 font-medium">
          Timeline
        </h2>
        <ol className="mt-5">
          {view.timeline.map((t, i) => (
            <li key={`${t.at}-${i}`} className="relative grid grid-cols-[20px_1fr] gap-3 pb-6 last:pb-0">
              {i < view.timeline.length - 1 ? <span aria-hidden className="absolute top-4 bottom-0 left-[9px] w-px bg-line-2" /> : null}
              <span aria-hidden className={`relative mt-1.5 ml-[5px] size-2.5 rounded-full ring-4 ring-paper ${TONE_DOT[t.tone]}`} />
              <div>
                <p className="text-[16px] leading-6 font-medium">{t.title}</p>
                {t.detail ? <p className="text-[15px] leading-6 text-ink-2">{t.detail}</p> : null}
                <AbsoluteTime iso={t.at} className="font-mono text-[12px] text-ink-3" />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-ink-3">
        {h?.lastVerifiedAt ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle {...ICON} aria-hidden /> Checked with PayPal <RelativeTime iso={h.lastVerifiedAt} />
          </span>
        ) : null}
        {error ? <span className="text-bad">Could not refresh just now, retrying</span> : null}
        <span>Keep this page’s link to check back later</span>
      </p>
    </article>
  );
}
