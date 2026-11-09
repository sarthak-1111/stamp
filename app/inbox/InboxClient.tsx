'use client';

import { CaretDown, Robot } from '@phosphor-icons/react';
import { AnimatePresence, m } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REC_COPY, SenderLine, TriagePanel } from '@/components/Message';
import { EASE } from '@/components/Motion';
import { HoldStamp, StateBadge } from '@/components/StateBadge';
import { Countdown, RelativeTime } from '@/components/Time';
import { SPAM_REASON_LABEL, SPAM_REASONS, VIA_LABEL, type SpamReason } from '@/lib/copy';
import { formatMoney, stampAmount } from '@/lib/money';
import type { InboxCard, InboxView } from '@/lib/views';

type Tab = 'open' | 'requests' | 'done';
type Action = 'reply' | 'worth_it' | 'spam' | 'grant' | 'decline';

const ICON = { size: 16, weight: 'bold' } as const;

/** Hairline dividers for a 2x2 grid on phones and a 1x4 row from sm up. */
const STAT_CELL = [
  '',
  'border-l border-line pl-4 sm:pl-6',
  'border-line max-sm:border-t sm:border-l sm:pl-6',
  'border-l border-line pl-4 max-sm:border-t sm:pl-6',
];

const DECISION_COPY: Record<string, string> = {
  reply: 'You replied',
  worth_it: 'You marked it worth it',
  spam: 'You marked it spam',
  grant: 'You granted a free pass',
  decline: 'You declined the free pass',
};

function isOpen(c: InboxCard): boolean {
  if (c.decision || c.lane === 'request') return false;
  if (c.lane === 'free') return true;
  return c.hold?.state === 'AUTHORIZED';
}

function suggestedReason(c: InboxCard): SpamReason {
  if (c.triage?.injection) return 'manipulation';
  if ((c.triage?.riskScore ?? 0) >= 70) return 'scam';
  return 'bulk';
}

function senderNote(c: InboxCard): string | null {
  if (c.lane === 'free') return 'Free lane. The address was typed by the sender and is not verified';
  if (c.lane === 'request') return 'Asked for a free pass instead of placing a hold';
  if (c.hold?.payerName) return `The hold was approved in PayPal by ${c.hold.payerName}`;
  return null;
}

export function InboxClient({ initial }: { initial: InboxView }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Tab>('open');
  const [drafts, setDrafts] = useState<Record<string, { text: string; edited: boolean; source: string | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<InboxCard | null>(null);
  const [reason, setReason] = useState<SpamReason>('bulk');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Keep AI drafts in sync until the recipient edits one.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of view.cards) {
        const d = next[c.messageId];
        const src = c.triage ? `${c.triage.source}:${c.triage.updatedAt}` : null;
        if (!d || (!d.edited && d.source !== src)) next[c.messageId] = { text: c.triage?.draftReply ?? '', edited: false, source: src };
      }
      return next;
    });
  }, [view]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/inbox', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setView(await res.json());
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!busyRef.current && document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (confirm) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [confirm]);

  async function act(card: InboxCard, action: Action, spamReason?: SpamReason) {
    setBusy(card.messageId);
    setErrors((e) => ({ ...e, [card.messageId]: '' }));
    try {
      const res = await fetch(`/api/inbox/${card.messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'reply' ? { replyText: drafts[card.messageId]?.text ?? '' } : {}),
          ...(action === 'spam' ? { confirm: true, reason: spamReason } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErrors((e) => ({ ...e, [card.messageId]: j.message ?? 'That did not work. Nothing changed.' }));
      await refresh();
    } catch {
      setErrors((e) => ({ ...e, [card.messageId]: 'Network error. Nothing changed.' }));
    } finally {
      setBusy(null);
    }
  }

  function askSpam(c: InboxCard) {
    setReason(suggestedReason(c));
    setConfirm(c);
  }

  const open = useMemo(() => view.cards.filter(isOpen), [view]);
  const requests = useMemo(() => view.cards.filter((c) => c.lane === 'request' && !c.decision), [view]);
  const done = useMemo(() => view.cards.filter((c) => !isOpen(c) && !(c.lane === 'request' && !c.decision)), [view]);
  const r = view.recipient;
  const first = r.displayName.split(/\s+/)[0];
  const tabs: Array<[Tab, string, number]> = [
    ['open', 'To decide', open.length],
    ['requests', 'Free-pass requests', requests.length],
    ['done', 'Done', done.length],
  ];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{first}’s inbox</h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-2">
            <Link href={`/@${r.handle}`} className="link font-mono text-[14px]">
              /@{r.handle}
            </Link>
            <span className="text-ink-3">
              {' '}
              · {stampAmount(r.holdCents)} hold · auto-release after {r.releaseLabel}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/ledger" className="btn btn-secondary btn-sm">
            Ledger
          </Link>
          <Link href="/setup" className="btn btn-secondary btn-sm">
            Settings
          </Link>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 border-y border-line sm:grid-cols-4">
        {[
          ['Held right now', formatMoney(view.stats.heldCents), `${view.stats.heldCount} ${view.stats.heldCount === 1 ? 'hold' : 'holds'}`, 'text-held'],
          ['Released to senders', String(view.stats.releasedCount), 'nothing charged', 'text-ink'],
          ['Donated for spam', formatMoney(view.stats.donatedCents), r.charityName, 'text-donated'],
          ['Your return rate', view.returns.rate === null ? 'New' : `${view.returns.rate}%`, `${view.returns.returned} of ${view.returns.decided} decided`, 'text-ink'],
        ].map(([k, v, hint, tone], i) => (
          <div key={k} className={`py-4 ${STAT_CELL[i]}`}>
            <dt className="text-[13px] leading-5 text-ink-3">{k}</dt>
            <dd className={`mt-1 font-mono text-[24px] leading-8 tabular-nums ${tone}`}>{v}</dd>
            <dd className="truncate text-[13px] leading-5 text-ink-3">{hint}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[14px] leading-6 text-ink-3">
        Stamp never pays you. Holds you mark as spam go to {r.charityName}; everything else goes back to the sender. Your return rate is shown on
        your public page.
      </p>

      <div role="tablist" aria-label="Messages" className="mt-8 flex gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1 sm:inline-flex">
        {tabs.map(([k, label, count]) => (
          <button
            key={k}
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls="inbox-panel"
            onClick={() => setTab(k)}
            className={`relative shrink-0 rounded-lg px-3 py-2 text-[14px] leading-5 font-medium transition-colors ${tab === k ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}
          >
            {tab === k ? <m.span layoutId="inbox-tab" className="absolute inset-0 rounded-lg bg-paper-2" transition={{ duration: 0.25, ease: EASE }} /> : null}
            <span className="relative">
              {label} <span className="font-mono text-[12px] text-ink-3 tabular-nums">{count}</span>
            </span>
          </button>
        ))}
      </div>

      <div id="inbox-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-5 grid gap-4">
        {tab === 'open' && open.length === 0 ? (
          <Empty>
            Nothing to decide right now. Share{' '}
            <Link className="link font-mono" href={`/@${r.handle}`}>
              /@{r.handle}
            </Link>{' '}
            to receive messages.
          </Empty>
        ) : null}
        {tab === 'requests' && requests.length === 0 ? (
          <Empty>No free-pass requests. People who cannot place a hold can ask for one from your page.</Empty>
        ) : null}
        {tab === 'done' && done.length === 0 ? <Empty>Decided and released messages appear here.</Empty> : null}

        <AnimatePresence initial={false} mode="popLayout">
          {tab === 'open'
            ? open.map((c) => (
                <Card key={c.messageId}>
                  <OpenCard
                    card={c}
                    draft={drafts[c.messageId]?.text ?? ''}
                    onDraft={(text) => setDrafts((d) => ({ ...d, [c.messageId]: { text, edited: true, source: d[c.messageId]?.source ?? null } }))}
                    busy={busy === c.messageId}
                    disabled={busy !== null}
                    error={errors[c.messageId]}
                    onReply={() => act(c, 'reply')}
                    onWorthIt={() => act(c, 'worth_it')}
                    onSpam={() => askSpam(c)}
                    onElapsed={refresh}
                  />
                </Card>
              ))
            : null}
          {tab === 'requests'
            ? requests.map((c) => (
                <Card key={c.messageId}>
                  <RequestCard card={c} busy={busy === c.messageId} disabled={busy !== null} error={errors[c.messageId]} onGrant={() => act(c, 'grant')} onDecline={() => act(c, 'decline')} />
                </Card>
              ))
            : null}
          {tab === 'done'
            ? done.map((c) => (
                <Card key={c.messageId}>
                  <DoneCard card={c} />
                </Card>
              ))
            : null}
        </AnimatePresence>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="spam-title"
        aria-describedby="spam-desc"
        onClose={() => setConfirm(null)}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-card p-0 text-ink shadow-[var(--shadow-lg)]"
      >
        {confirm ? (
          <form
            method="dialog"
            className="p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const c = confirm;
              setConfirm(null);
              void act(c, 'spam', reason);
            }}
          >
            <h2 id="spam-title" className="text-[22px] leading-7 font-medium text-balance">
              {confirm.hold ? `Mark as spam and donate ${stampAmount(confirm.hold.amountCents)}?` : 'Mark as spam?'}
            </h2>
            <p id="spam-desc" className="mt-3 text-[15px] leading-6 text-ink-2">
              {confirm.hold ? (
                <>
                  The {stampAmount(confirm.hold.amountCents)} hold from {confirm.hold.payerName ?? confirm.senderName} is captured and donated to{' '}
                  <span className="text-ink">{confirm.hold.charityName}</span> after PayPal’s fee. <span className="text-ink">You receive nothing.</span> This
                  cannot be undone.
                </>
              ) : (
                <>This message came through your free lane, so no money moves.</>
              )}
            </p>
            <fieldset className="mt-5">
              <legend className="text-[14px] leading-5 font-medium">Reason, shown to the sender</legend>
              <div className="mt-2 grid gap-1">
                {SPAM_REASONS.map((k) => (
                  <label key={k} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors ${reason === k ? 'bg-paper-2' : 'hover:bg-paper-2'}`}>
                    <input type="radio" name="spam-reason" value={k} checked={reason === k} onChange={() => setReason(k)} className="accent-[var(--ink)]" />
                    {SPAM_REASON_LABEL[k]}
                    {k === suggestedReason(confirm) && confirm.triage ? <span className="ml-auto text-[12px] text-ink-3">AI suggests</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
            {confirm.triage && confirm.triage.recommendation !== 'spam' ? (
              <p className="mt-4 rounded-lg bg-held-bg px-3 py-2 text-[14px] leading-5 text-held">The AI did not flag this message as spam. Make sure it really is.</p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger-solid">
                {confirm.hold ? 'Capture and donate' : 'Mark as spam'}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <m.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }} transition={{ duration: 0.3, ease: EASE }}>
      {children}
    </m.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line-2 px-6 py-10 text-center text-[15px] leading-6 text-ink-2">{children}</div>;
}

function AgentNote({ card }: { card: InboxCard }) {
  if (card.via === 'web') return null;
  return (
    <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] leading-5 text-ink-2">
      <Robot {...ICON} aria-hidden className="text-ink-3" />
      Sent by an AI agent{card.agentName ? `: ${card.agentName}` : ''}, via {VIA_LABEL[card.via]}
    </p>
  );
}

function OpenCard(props: {
  card: InboxCard;
  draft: string;
  onDraft: (t: string) => void;
  busy: boolean;
  disabled: boolean;
  error?: string;
  onReply: () => void;
  onWorthIt: () => void;
  onSpam: () => void;
  onElapsed: () => void;
}) {
  const { card: c } = props;
  const amount = c.hold ? stampAmount(c.hold.amountCents) : null;
  const id = `msg-${c.messageId}`;
  return (
    <article aria-labelledby={`${id}-subject`} className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SenderLine name={c.senderName} email={c.senderEmail} note={senderNote(c)} />
          <AgentNote card={c} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {c.hold ? <HoldStamp cents={c.hold.amountCents} currency={c.hold.currency} /> : <span className="tag !text-[12px]">Free lane</span>}
          {c.hold?.releaseAt ? (
            <span className="font-mono text-[12px] leading-4 text-ink-3">
              <Countdown until={c.hold.releaseAt} prefix="Releases in" onElapsed={props.onElapsed} />
            </span>
          ) : null}
        </div>
      </div>
      <h2 id={`${id}-subject`} className="mt-3 text-[18px] leading-7 font-medium text-balance">
        {c.subject}
      </h2>

      <div className="mt-4">{c.triage ? <TriagePanel triage={c.triage} /> : <p className="well p-4 text-[14px] text-ink-3">Triage pending…</p>}</div>

      <details className="group mt-3 rounded-xl border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] leading-5 font-medium text-ink-2 select-none">
          Read the full message
          <CaretDown {...ICON} aria-hidden className="text-ink-3 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-4 py-3">
          <p className="text-[15px] leading-7 break-words whitespace-pre-wrap">{c.body}</p>
          <p className="mt-2 text-[12px] leading-4 text-ink-3">Shown as plain text. Links are not clickable.</p>
        </div>
      </details>

      <div className="mt-4">
        <label htmlFor={`${id}-reply`} className="text-[14px] leading-5 font-medium">
          Reply <span className="font-normal text-ink-3">drafted by the AI, edit before sending</span>
        </label>
        <textarea id={`${id}-reply`} className="field mt-1.5" rows={3} value={props.draft} onChange={(e) => props.onDraft(e.target.value)} maxLength={2000} />
      </div>

      {props.error ? (
        <p role="alert" className="mt-3 text-[14px] text-bad">
          {props.error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="btn btn-primary" disabled={props.disabled || !props.draft.trim()} onClick={props.onReply}>
          {props.busy ? 'Working…' : c.hold ? `Send reply and release ${amount}` : 'Send reply'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={props.disabled} onClick={props.onWorthIt}>
          {c.hold ? 'Worth it, release' : 'Worth it'}
        </button>
        <button type="button" className="btn btn-danger sm:ml-auto" disabled={props.disabled} onClick={props.onSpam}>
          {c.hold ? `Spam, donate ${amount}` : 'Spam'}
        </button>
      </div>
    </article>
  );
}

function RequestCard(props: { card: InboxCard; busy: boolean; disabled: boolean; error?: string; onGrant: () => void; onDecline: () => void }) {
  const { card: c } = props;
  const t = c.triage;
  const risky = t && (t.injection || t.riskScore >= 40);
  return (
    <article className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <SenderLine name={c.senderName} email={c.senderEmail} />
        <RelativeTime iso={c.createdAt} className="shrink-0 font-mono text-[12px] text-ink-3" />
      </div>
      <p className="mt-3 text-[16px] leading-7 break-words whitespace-pre-wrap">{c.body}</p>
      {risky ? (
        <p className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[14px] leading-5 text-bad">
          {t.injection ? 'This request tried to give the AI instructions. They were ignored. ' : ''}Risk {t.riskScore}: {t.riskReason}
        </p>
      ) : null}
      {props.error ? (
        <p role="alert" className="mt-3 text-[14px] text-bad">
          {props.error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-primary" disabled={props.disabled} onClick={props.onGrant}>
          {props.busy ? 'Working…' : 'Grant free pass'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={props.disabled} onClick={props.onDecline}>
          Decline
        </button>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-ink-3">Granting adds {c.senderEmail} to your free lane. You can remove it in Settings.</p>
    </article>
  );
}

function DoneCard({ card: c }: { card: InboxCard }) {
  const rec = c.triage ? REC_COPY[c.triage.recommendation] : null;
  const live = Boolean(c.hold?.pendingOp) || c.hold?.state === 'CAPTURED';
  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <SenderLine name={c.senderName} email={c.senderEmail} />
        {c.hold ? (
          <StateBadge tone={c.hold.tone} label={c.hold.stateLabel} live={live} />
        ) : (
          <StateBadge tone="neutral" label={c.lane === 'request' ? 'Free-pass request' : 'Free lane'} />
        )}
      </div>
      <h2 className="mt-2 text-[16px] leading-6 font-medium">{c.subject}</h2>
      <p className="mt-1 text-[14px] leading-6 text-ink-2">
        {c.decision ? DECISION_COPY[c.decision] : (c.hold?.outcomeLabel ?? 'No decision')}
        {c.decisionReason ? `: ${SPAM_REASON_LABEL[c.decisionReason].toLowerCase()}` : ''}
        {c.decidedAt ? (
          <>
            {' '}
            · <RelativeTime iso={c.decidedAt} />
          </>
        ) : null}
        {rec && c.lane !== 'request' ? <span className="text-ink-3"> · AI suggested: {rec.label.toLowerCase()}</span> : null}
      </p>
      {c.hold?.state === 'DONATED' ? (
        <p className="mt-1 text-[14px] leading-6 text-donated">
          {formatMoney(c.hold.donatedCents)} donated to {c.hold.charityName}, PayPal fee {formatMoney(c.hold.feeCents)}
        </p>
      ) : null}
      {c.replyText ? <p className="well mt-3 px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap">{c.replyText}</p> : null}
    </article>
  );
}
