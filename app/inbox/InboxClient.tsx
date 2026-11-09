'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScoreMeter } from '@/components/ScoreMeter';
import { StateBadge } from '@/components/StateBadge';
import { Countdown, RelativeTime } from '@/components/Time';
import { formatMoney } from '@/lib/money';
import type { InboxCard, InboxView } from '@/lib/views';

const REC_COPY: Record<string, { label: string; tone: 'good' | 'held' | 'bad' | 'neutral' }> = {
  reply: { label: 'Worth a reply', tone: 'good' },
  worth_it: { label: 'Not spam: release', tone: 'good' },
  review: { label: 'Check carefully', tone: 'held' },
  spam: { label: 'Looks like spam', tone: 'bad' },
};

const DECISION_COPY: Record<string, string> = { reply: 'You replied', worth_it: 'You marked it worth it', spam: 'You marked it spam' };

function isOpen(c: InboxCard): boolean {
  if (c.decision) return false;
  if (c.lane === 'free') return true;
  return c.hold?.state === 'AUTHORIZED';
}

export function InboxClient({ initial }: { initial: InboxView }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [drafts, setDrafts] = useState<Record<string, { text: string; edited: boolean; source: string | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<InboxCard | null>(null);
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

  async function act(card: InboxCard, action: 'reply' | 'worth_it' | 'spam') {
    setBusy(card.messageId);
    setErrors((e) => ({ ...e, [card.messageId]: '' }));
    try {
      const res = await fetch(`/api/inbox/${card.messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'reply' ? { replyText: drafts[card.messageId]?.text ?? '' } : {}),
          ...(action === 'spam' ? { confirm: true } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErrors((e) => ({ ...e, [card.messageId]: j.message ?? 'That did not work. Nothing changed.' }));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const open = useMemo(() => view.cards.filter(isOpen), [view]);
  const done = useMemo(() => view.cards.filter((c) => !isOpen(c)), [view]);
  const list = tab === 'open' ? open : done;
  const r = view.recipient;
  const first = r.displayName.split(/\s+/)[0];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Private inbox</p>
          <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight">{first}’s inbox</h1>
          <p className="mt-2 text-ink-2">
            Public page{' '}
            <Link href={`/@${r.handle}`} className="font-semibold text-stamp-ink underline underline-offset-4">
              /@{r.handle}
            </Link>{' '}
            · {formatMoney(r.holdCents)} hold · releases after {r.releaseLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/ledger" className="btn btn-ghost !min-h-10 !py-2 text-sm">
            Ledger
          </Link>
          <Link href="/setup" className="btn btn-ghost !min-h-10 !py-2 text-sm">
            Settings
          </Link>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <div className="card p-4">
          <dt className="text-sm text-ink-3">Held now</dt>
          <dd className="font-display mt-1 text-2xl font-semibold text-held">{formatMoney(view.stats.heldCents)}</dd>
        </div>
        <div className="card p-4">
          <dt className="text-sm text-ink-3">Released</dt>
          <dd className="font-display mt-1 text-2xl font-semibold text-good">{view.stats.releasedCount}</dd>
        </div>
        <div className="card p-4">
          <dt className="text-sm text-ink-3">Donated</dt>
          <dd className="font-display mt-1 text-2xl font-semibold text-donated">{formatMoney(view.stats.donatedCents)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-ink-3">
        Stamp never pays you. Holds you mark as spam go to {r.charityName}; everything else is released.
      </p>

      <div role="tablist" aria-label="Messages" className="mt-8 inline-flex rounded-full border border-line bg-card p-1">
        {(
          [
            ['open', `To decide (${open.length})`],
            ['done', `Done (${done.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-5 grid gap-4">
        {list.length === 0 ? (
          <div className="card p-8 text-center text-ink-2">
            {tab === 'open' ? (
              <>
                Nothing to decide right now. Share{' '}
                <Link className="font-semibold text-stamp-ink underline underline-offset-4" href={`/@${r.handle}`}>
                  /@{r.handle}
                </Link>{' '}
                to receive messages.
              </>
            ) : (
              'Decided and released messages will appear here.'
            )}
          </div>
        ) : null}
        {list.map((c) =>
          tab === 'open' ? (
            <OpenCard
              key={c.messageId}
              card={c}
              draft={drafts[c.messageId]?.text ?? ''}
              onDraft={(text) => setDrafts((d) => ({ ...d, [c.messageId]: { text, edited: true, source: d[c.messageId]?.source ?? null } }))}
              busy={busy === c.messageId}
              disabled={busy !== null}
              error={errors[c.messageId]}
              onReply={() => act(c, 'reply')}
              onWorthIt={() => act(c, 'worth_it')}
              onSpam={() => (c.lane === 'free' ? act(c, 'spam') : setConfirm(c))}
              onElapsed={refresh}
            />
          ) : (
            <DoneCard key={c.messageId} card={c} />
          ),
        )}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="spam-title"
        aria-describedby="spam-desc"
        onClose={() => setConfirm(null)}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-card p-0 text-ink"
      >
        {confirm?.hold ? (
          <div className="p-6">
            <h2 id="spam-title" className="font-display text-2xl font-semibold">
              Mark as spam and donate {formatMoney(confirm.hold.amountCents)}?
            </h2>
            <p id="spam-desc" className="mt-3 text-ink-2">
              The {formatMoney(confirm.hold.amountCents)} hold from {confirm.hold.payerName ?? confirm.senderName} will be captured and donated to{' '}
              <strong className="text-ink">{confirm.hold.charityName}</strong> after PayPal’s fee. <strong className="text-ink">You receive nothing.</strong>{' '}
              This can’t be undone.
            </p>
            {confirm.triage && confirm.triage.recommendation !== 'spam' ? (
              <p className="mt-3 rounded-lg bg-held-bg px-3 py-2 text-sm text-held">The AI did not flag this message as spam. Make sure it really is.</p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" autoFocus onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  void act(c, 'spam');
                }}
              >
                Capture and donate
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

function SenderLine({ card }: { card: InboxCard }) {
  return (
    <p className="text-sm text-ink-2">
      <span className="font-semibold text-ink">{card.senderName}</span> <span className="text-ink-3">&lt;{card.senderEmail}&gt;</span>
      {card.lane === 'free' ? (
        <span className="ml-2 chip !py-0 !text-xs" title="Free-lane addresses are typed by the sender and not verified.">
          Free lane · address not verified
        </span>
      ) : card.hold?.payerName ? (
        <span className="ml-2 chip !py-0 !text-xs" title="The name on the PayPal account that approved the hold.">
          Paid with PayPal as {card.hold.payerName}
        </span>
      ) : null}
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
  const t = c.triage;
  const rec = t ? REC_COPY[t.recommendation] : null;
  const amount = c.hold ? formatMoney(c.hold.amountCents) : null;
  const id = `msg-${c.messageId}`;
  return (
    <article aria-labelledby={`${id}-subject`} className="card overflow-hidden">
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SenderLine card={c} />
          <div className="flex flex-wrap items-center gap-2">
            {c.hold ? <StateBadge tone={c.hold.tone} label={`${amount} held`} /> : null}
            {c.hold?.releaseAt ? (
              <span className="text-sm text-ink-3">
                <Countdown until={c.hold.releaseAt} onElapsed={props.onElapsed} />
              </span>
            ) : null}
          </div>
        </div>
        <h2 id={`${id}-subject`} className="text-lg leading-snug font-semibold">
          {c.subject}
        </h2>

        {t ? (
          <section aria-label="AI triage" className="rounded-xl border border-line bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[15px]">
                <span className="mr-2 rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-paper">AI</span>
                {t.summary}
              </p>
              {rec ? <StateBadge tone={rec.tone === 'bad' ? 'bad' : rec.tone} label={`Suggests: ${rec.label}`} /> : null}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ScoreMeter label="Fit with your topics" value={t.fitScore} kind="fit" reason={t.fitReason} />
              <ScoreMeter label="Scam / phishing risk" value={t.riskScore} kind="risk" reason={t.riskReason} />
            </div>
            {t.injection ? (
              <p className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-sm font-semibold text-bad">
                This message tried to instruct the AI. It was ignored, and nothing about the hold changed.
              </p>
            ) : null}
            {t.flags.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Red flags">
                {t.flags.map((f) => (
                  <li key={f} className="chip !border-bad/25 !bg-bad-bg !text-xs !text-bad">
                    {f}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-ink-3">
              {t.source === 'model' ? `${t.model ?? 'Model'}${t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)}s` : ''}` : 'Rule-based triage'}
              {t.source === 'rules' && t.modelError ? ' (the model was unavailable)' : ''} · A suggestion only. You decide.
            </p>
          </section>
        ) : (
          <p className="text-sm text-ink-3">Triage pending…</p>
        )}

        <details className="group rounded-xl border border-line">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-2 select-none group-open:border-b group-open:border-line">
            Read the full message
          </summary>
          <p className="px-4 py-3 break-words whitespace-pre-wrap">{c.body}</p>
          <p className="px-4 pb-3 text-xs text-ink-3">Shown as plain text. Links are not clickable.</p>
        </details>

        <div>
          <label htmlFor={`${id}-reply`} className="text-sm font-semibold text-ink-2">
            Reply <span className="font-normal text-ink-3">(drafted by the AI; edit before sending)</span>
          </label>
          <textarea id={`${id}-reply`} className="field mt-1.5" rows={3} value={props.draft} onChange={(e) => props.onDraft(e.target.value)} maxLength={2000} />
        </div>

        {props.error ? (
          <p role="alert" className="text-sm text-bad">
            {props.error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" className="btn btn-ink" disabled={props.disabled || !props.draft.trim()} onClick={props.onReply}>
            {props.busy ? 'Working…' : c.hold ? `Send reply & release ${amount}` : 'Send reply'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={props.disabled} onClick={props.onWorthIt}>
            {c.hold ? 'Worth it: release' : 'Worth it'}
          </button>
          <button type="button" className="btn btn-danger sm:ml-auto" disabled={props.disabled} onClick={props.onSpam}>
            {c.hold ? `Spam: donate ${amount}` : 'Spam'}
          </button>
        </div>
      </div>
    </article>
  );
}

function DoneCard({ card: c }: { card: InboxCard }) {
  const t = c.triage;
  const rec = t ? REC_COPY[t.recommendation] : null;
  const busy = Boolean(c.hold?.pendingOp) || c.hold?.state === 'CAPTURED';
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SenderLine card={c} />
        {c.hold ? <StateBadge tone={c.hold.tone} label={c.hold.stateLabel} live={busy} /> : <StateBadge tone="neutral" label="Free lane" />}
      </div>
      <h2 className="mt-2 font-semibold">{c.subject}</h2>
      <p className="mt-2 text-sm text-ink-2">
        {c.decision ? DECISION_COPY[c.decision] : (c.hold?.outcomeLabel ?? 'No decision')}
        {c.decidedAt ? (
          <>
            {' '}
            · <RelativeTime iso={c.decidedAt} />
          </>
        ) : null}
        {rec ? <span className="text-ink-3"> · AI suggested: {rec.label}</span> : null}
      </p>
      {c.hold?.state === 'DONATED' ? (
        <p className="mt-1 text-sm text-donated">
          {formatMoney(c.hold.donatedCents)} donated to {c.hold.charityName} (PayPal fee {formatMoney(c.hold.feeCents)}).
        </p>
      ) : null}
      {c.replyText ? <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm whitespace-pre-wrap">{c.replyText}</p> : null}
    </article>
  );
}
