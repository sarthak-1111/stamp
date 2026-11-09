'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

type Props = { handle: string; amountLabel: string; firstName: string; hasFreeLane: boolean };
type Mode = 'hold' | 'request';

const ICON = { size: 16, weight: 'bold' } as const;

export function SendForm({ handle, amountLabel, firstName, hasFreeLane }: Props) {
  const uid = useId();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('hold');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'redirecting'>('idle');

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFormError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPhase('sending');
    setErrors({});
    setFormError(null);
    try {
      const res =
        mode === 'hold'
          ? await fetch('/api/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ handle, senderName, senderEmail, subject, body, website }),
            })
          : await fetch('/api/requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ handle, senderName, senderEmail, note, website }),
            });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(j.fields ?? {});
        setFormError(j.message ?? (j.fields ? 'Please fix the highlighted fields' : 'Could not send. Please try again'));
        setPhase('idle');
        return;
      }
      setPhase('redirecting');
      if (j.approveUrl) window.location.assign(j.approveUrl);
      else router.push(j.statusUrl);
    } catch {
      setFormError('Network error. Nothing was held or charged. Please try again');
      setPhase('idle');
    }
  }

  const err = (k: string) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${uid}-${k}-err` } : {});
  const ErrorText = ({ k }: { k: string }) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="mt-1.5 text-[14px] text-bad">
        {errors[k]}
      </p>
    ) : null;

  const label = 'text-[14px] leading-5 font-medium';
  const busy = phase !== 'idle';

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div>
        {mode === 'request' ? (
          <button type="button" onClick={() => switchMode('hold')} className="btn btn-quiet btn-sm -ml-3 mb-2">
            <ArrowLeft {...ICON} aria-hidden />
            Write with a hold instead
          </button>
        ) : null}
        <h2 id="compose" className="text-[20px] leading-7 font-medium">
          {mode === 'hold' ? 'Your message' : 'Ask for a free pass'}
        </h2>
        {mode === 'request' ? (
          <p className="mt-1 text-[15px] leading-6 text-ink-2">
            No hold and no PayPal. If {firstName} grants it, you can write from this address without a hold. One request per week.
          </p>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-[15px] text-bad">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-name`} className={label}>
            Your name
          </label>
          <input id={`${uid}-name`} className="field mt-1.5" autoComplete="name" value={senderName} onChange={(e) => setSenderName(e.target.value)} maxLength={80} {...err('senderName')} />
          <ErrorText k="senderName" />
        </div>
        <div>
          <label htmlFor={`${uid}-email`} className={label}>
            Your email
          </label>
          <input
            id={`${uid}-email`}
            className="field mt-1.5"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            maxLength={254}
            {...err('senderEmail')}
          />
          <ErrorText k="senderEmail" />
        </div>
      </div>

      {mode === 'hold' ? (
        <>
          <div>
            <label htmlFor={`${uid}-subject`} className={label}>
              Subject
            </label>
            <input id={`${uid}-subject`} className="field mt-1.5" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} {...err('subject')} />
            <ErrorText k="subject" />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${uid}-body`} className={label}>
                Message
              </label>
              <span className={`font-mono text-[12px] tabular-nums ${body.length > 2000 ? 'text-bad' : 'text-ink-3'}`} aria-live="polite">
                {body.length} / 2000
              </span>
            </div>
            <textarea
              id={`${uid}-body`}
              className="field mt-1.5 min-h-[176px]"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Who you are, what you would like from ${firstName}, and why them`}
              {...err('body')}
            />
            <ErrorText k="body" />
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={`${uid}-note`} className={label}>
              Why a free pass
            </label>
            <span className={`font-mono text-[12px] tabular-nums ${note.length > 280 ? 'text-bad' : 'text-ink-3'}`} aria-live="polite">
              {note.length} / 280
            </span>
          </div>
          <textarea
            id={`${uid}-note`}
            className="field mt-1.5"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example: I am a student and cannot use PayPal yet"
            {...err('note')}
          />
          <ErrorText k="note" />
        </div>
      )}

      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input id={`${uid}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div className="grid gap-3">
        <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto sm:justify-self-start" disabled={busy}>
          {mode === 'hold'
            ? phase === 'sending'
              ? 'Starting PayPal checkout…'
              : phase === 'redirecting'
                ? 'Opening PayPal…'
                : `Hold ${amountLabel} with PayPal and send`
            : phase === 'idle'
              ? 'Send request'
              : 'Sending…'}
        </button>
        {mode === 'hold' ? (
          <p className="text-[14px] leading-6 text-ink-3">
            You approve a {amountLabel} authorization in PayPal’s sandbox: a hold, not a payment.
            {hasFreeLane ? ` If ${firstName} added your address to their free lane, no hold is needed and your message goes straight through.` : ''}{' '}
            <button type="button" onClick={() => switchMode('request')} className="link">
              Can’t place a hold? Ask for a free pass
            </button>
          </p>
        ) : null}
      </div>
    </form>
  );
}
