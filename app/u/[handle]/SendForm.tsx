'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

type Props = { handle: string; amountLabel: string; firstName: string; hasFreeLane: boolean };

export function SendForm({ handle, amountLabel, firstName, hasFreeLane }: Props) {
  const uid = useId();
  const router = useRouter();
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'redirecting'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPhase('sending');
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, senderName, senderEmail, subject, body, website }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(j.fields ?? {});
        setFormError(j.message ?? (j.fields ? 'Please fix the highlighted fields.' : 'Could not send. Please try again.'));
        setPhase('idle');
        return;
      }
      setPhase('redirecting');
      if (j.approveUrl) window.location.assign(j.approveUrl);
      else router.push(j.statusUrl);
    } catch {
      setFormError('Network error. Nothing was held or charged. Please try again.');
      setPhase('idle');
    }
  }

  const err = (k: string) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${uid}-${k}-err` } : {});
  const ErrorText = ({ k }: { k: string }) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="mt-1.5 text-sm text-bad">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="mt-5 grid gap-4">
      {formError ? (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-bad">
          {formError}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-name`} className="font-semibold">
            Your name
          </label>
          <input id={`${uid}-name`} className="field mt-1.5" autoComplete="name" value={senderName} onChange={(e) => setSenderName(e.target.value)} maxLength={80} {...err('senderName')} />
          <ErrorText k="senderName" />
        </div>
        <div>
          <label htmlFor={`${uid}-email`} className="font-semibold">
            Your email
          </label>
          <input
            id={`${uid}-email`}
            className="field mt-1.5"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            maxLength={254}
            {...err('senderEmail')}
          />
          <ErrorText k="senderEmail" />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-subject`} className="font-semibold">
          Subject
        </label>
        <input id={`${uid}-subject`} className="field mt-1.5" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} {...err('subject')} />
        <ErrorText k="subject" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${uid}-body`} className="font-semibold">
            Message
          </label>
          <span className={`text-sm tabular-nums ${body.length > 2000 ? 'text-bad' : 'text-ink-3'}`} aria-live="polite">
            {body.length} / 2000
          </span>
        </div>
        <textarea
          id={`${uid}-body`}
          className="field mt-1.5"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Who you are, what you'd like from ${firstName}, and why them.`}
          {...err('body')}
        />
        <ErrorText k="body" />
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input id={`${uid}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <button type="submit" className="btn btn-primary mt-2 w-full sm:w-auto" disabled={phase !== 'idle'}>
        {phase === 'sending' ? 'Starting PayPal checkout…' : phase === 'redirecting' ? 'Opening PayPal…' : `Hold ${amountLabel} with PayPal and send`}
      </button>
      <p className="text-sm text-ink-3">
        You’ll approve a {amountLabel} <strong className="text-ink-2">authorization</strong> in PayPal’s sandbox: a hold, not a payment.
        {hasFreeLane ? ` If ${firstName} added your address to their free lane, no hold is needed and your message goes straight through.` : ''}
      </p>
    </form>
  );
}
