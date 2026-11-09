'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

type Initial = {
  handle: string;
  displayName: string;
  bio: string;
  holdDollars: number;
  topics: string;
  freeLane: string;
  releaseMinutes: number;
  charityId: string;
};

type Props = {
  mode: 'create' | 'edit';
  charities: Array<{ id: string; name: string; blurb: string }>;
  windows: Array<{ minutes: number; label: string }>;
  initial: Initial | null;
};

const PRESETS = [1, 3, 5, 10, 20];

/** PayPal's published US checkout rate (3.49% + $0.49). Matches the $0.66 fee observed on a $5.00 sandbox capture. */
function netToCharity(dollars: number): number {
  const fee = Math.round((dollars * 0.0349 + 0.49) * 100) / 100;
  return Math.max(0, Math.round((dollars - fee) * 100) / 100);
}

export function SetupForm({ mode, charities, windows, initial }: Props) {
  const uid = useId();
  const [handle, setHandle] = useState(initial?.handle ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [holdDollars, setHoldDollars] = useState<number>(initial?.holdDollars ?? 5);
  const [topics, setTopics] = useState(initial?.topics ?? '');
  const [freeLane, setFreeLane] = useState(initial?.freeLane ?? '');
  const [releaseMinutes, setReleaseMinutes] = useState<number>(initial?.releaseMinutes ?? 48 * 60);
  const [charityId, setCharityId] = useState(initial?.charityId ?? charities[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [handleNote, setHandleNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ handle: string; ownerKey: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const topicChips = useMemo(
    () => [...new Set(topics.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 8),
    [topics],
  );

  async function checkHandle() {
    if (mode !== 'create' || !handle.trim()) return;
    const res = await fetch(`/api/recipients?handle=${encodeURIComponent(handle.trim())}`).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    setHandleNote(j ? (j.available ? 'Available' : j.reason) : null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/recipients', {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          displayName,
          bio,
          holdDollars,
          topics: topicChips,
          freeLane: freeLane.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          releaseMinutes,
          charityId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(j.fields ?? {});
        setFormError(j.message ?? 'Please fix the highlighted fields.');
        return;
      }
      if (mode === 'create') setCreated({ handle: j.handle, ownerKey: j.ownerKey });
      else setSaved(true);
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const link = `${window.location.origin}/signin#key=${created.ownerKey}`;
    return (
      <section aria-labelledby={`${uid}-done`} className="card mt-8 p-6 sm:p-8">
        <h2 id={`${uid}-done`} className="font-display text-2xl font-semibold">
          @{created.handle} is live
        </h2>
        <p className="mt-2 text-ink-2">
          Share your page: <Link className="font-semibold text-stamp-ink underline underline-offset-4" href={`/@${created.handle}`}>/@{created.handle}</Link>
        </p>
        <div className="mt-6 rounded-xl border border-held/30 bg-held-bg p-4">
          <p className="font-semibold text-held">Save your private inbox link</p>
          <p className="mt-1 text-[15px] text-ink-2">
            There are no passwords. This link is the only way to open your inbox on another device, and it is shown once.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={link} aria-label="Private inbox link" className="field font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-ink shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/inbox" className="btn btn-primary">
            Open your inbox
          </Link>
          <Link href={`/@${created.handle}`} className="btn btn-ghost">
            View your public page
          </Link>
        </div>
      </section>
    );
  }

  const err = (k: string) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${uid}-${k}-err` } : {});
  const ErrorText = ({ k }: { k: string }) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="mt-1.5 text-sm text-bad">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-6">
      {formError ? (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-bad">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-xl border border-good/30 bg-good-bg px-4 py-3 text-good">
          Saved. New messages use these terms; holds already placed keep theirs.
        </p>
      ) : null}

      <fieldset className="card grid gap-5 p-5 sm:p-6">
        <legend className="sr-only">Your page</legend>
        <div>
          <label htmlFor={`${uid}-handle`} className="font-semibold">
            Handle
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <span aria-hidden className="text-ink-3">
              stamp/@
            </span>
            <input
              id={`${uid}-handle`}
              className="field"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value.toLowerCase());
                setHandleNote(null);
              }}
              onBlur={checkHandle}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              disabled={mode === 'edit'}
              placeholder="ana"
              {...err('handle')}
            />
          </div>
          {handleNote && !errors.handle ? (
            <p className={`mt-1.5 text-sm ${handleNote === 'Available' ? 'text-good' : 'text-bad'}`} aria-live="polite">
              {handleNote}
            </p>
          ) : null}
          <ErrorText k="handle" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-name`} className="font-semibold">
              Display name
            </label>
            <input id={`${uid}-name`} className="field mt-1.5" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Ana Ruiz" {...err('displayName')} />
            <ErrorText k="displayName" />
          </div>
          <div>
            <label htmlFor={`${uid}-topics`} className="font-semibold">
              Topics you want to hear about
            </label>
            <input id={`${uid}-topics`} className="field mt-1.5" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="climate tech, hiring, battery storage" aria-describedby={`${uid}-topics-help`} {...err('topics')} />
            <p id={`${uid}-topics-help`} className="mt-1.5 text-sm text-ink-3">
              Comma-separated, up to 8. The AI scores each message against these.
            </p>
            {topicChips.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Topics">
                {topicChips.map((t) => (
                  <li key={t} className="chip">
                    {t}
                  </li>
                ))}
              </ul>
            ) : null}
            <ErrorText k="topics" />
          </div>
        </div>
        <div>
          <label htmlFor={`${uid}-bio`} className="font-semibold">
            Short bio <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <textarea id={`${uid}-bio`} className="field mt-1.5" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} placeholder="Founder at a battery startup. I read everything; I reply to what's relevant." />
        </div>
      </fieldset>

      <fieldset className="card grid gap-5 p-5 sm:p-6">
        <legend className="sr-only">Terms</legend>
        <div>
          <span id={`${uid}-hold-label`} className="font-semibold">
            Refundable hold
          </span>
          <div role="group" aria-labelledby={`${uid}-hold-label`} className="mt-2 flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={holdDollars === p}
                onClick={() => setHoldDollars(p)}
                className={`btn !min-h-10 !px-4 !py-1.5 ${holdDollars === p ? 'btn-ink' : 'btn-ghost'}`}
              >
                ${p}
              </button>
            ))}
            <label htmlFor={`${uid}-hold`} className="sr-only">
              Custom amount in dollars
            </label>
            <input
              id={`${uid}-hold`}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              className="field !w-24"
              value={holdDollars}
              onChange={(e) => setHoldDollars(Number(e.target.value))}
              {...err('holdDollars')}
            />
          </div>
          <p className="mt-2 text-sm text-ink-3">
            $1 to $20. If you mark a message as spam, about <strong className="text-ink-2">${netToCharity(holdDollars || 0).toFixed(2)}</strong> reaches the
            charity after PayPal&apos;s fee (3.49% + $0.49). Stamp covers the payout fee.
          </p>
          <ErrorText k="holdDollars" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-window`} className="font-semibold">
              Auto-release window
            </label>
            <select id={`${uid}-window`} className="field mt-1.5" value={releaseMinutes} onChange={(e) => setReleaseMinutes(Number(e.target.value))} {...err('releaseMinutes')}>
              {windows.map((w) => (
                <option key={w.minutes} value={w.minutes}>
                  {w.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-sm text-ink-3">Unanswered holds are released when it ends. Demo windows are for trying the flow.</p>
            <ErrorText k="releaseMinutes" />
          </div>
          <div>
            <label htmlFor={`${uid}-free`} className="font-semibold">
              Free lane <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <textarea id={`${uid}-free`} className="field mt-1.5 font-mono text-sm" rows={3} value={freeLane} onChange={(e) => setFreeLane(e.target.value)} placeholder={'@mycompany.com\nfriend@example.org'} aria-describedby={`${uid}-free-help`} {...err('freeLane')} />
            <p id={`${uid}-free-help`} className="mt-1.5 text-sm text-ink-3">
              One address or @domain per line. These senders skip the hold.
            </p>
            <ErrorText k="freeLane" />
          </div>
        </div>
        <div>
          <span id={`${uid}-charity-label`} className="font-semibold">
            Charity for spam holds
          </span>
          <div role="radiogroup" aria-labelledby={`${uid}-charity-label`} className="mt-2 grid gap-2">
            {charities.length === 0 ? <p className="text-bad">No charity is configured on this server.</p> : null}
            {charities.map((c) => (
              <label key={c.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${charityId === c.id ? 'border-ink bg-paper' : 'border-line'}`}>
                <input type="radio" name="charity" value={c.id} checked={charityId === c.id} onChange={() => setCharityId(c.id)} className="mt-1 accent-[var(--stamp)]" />
                <span>
                  <span className="font-semibold">{c.name}</span>
                  <span className="mt-0.5 block text-sm text-ink-3">{c.blurb}</span>
                </span>
              </label>
            ))}
          </div>
          <ErrorText k="charityId" />
        </div>
      </fieldset>

      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-3">Stamp never pays you. Released holds cost the sender nothing.</p>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create my page' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
