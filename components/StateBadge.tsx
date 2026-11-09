import { stampAmount } from '@/lib/money';
import type { HoldView } from '@/lib/views';

type Tone = HoldView['tone'];

const TONES: Record<Tone, string> = {
  neutral: 'bg-paper-2 text-ink-2',
  held: 'bg-held-bg text-held',
  good: 'bg-good-bg text-good',
  donated: 'bg-donated-bg text-donated',
  bad: 'bg-bad-bg text-bad',
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  held: 'text-held',
  good: 'text-good',
  donated: 'text-donated',
  bad: 'text-bad',
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  held: 'bg-held',
  good: 'bg-good',
  donated: 'bg-donated',
  bad: 'bg-bad',
};

/** Status tag: "Held, not charged". The words carry the meaning; colour only reinforces it. */
export function StateBadge({ tone, label, live = false }: { tone: Tone; label: string; live?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] leading-5 font-medium ${TONES[tone]}`}>
      <span aria-hidden className={`size-1.5 rounded-full bg-current ${live ? 'live-dot' : ''}`} />
      {label}
    </span>
  );
}

/** The signature: every hold amount is shown as a small perforated stamp. */
export function HoldStamp({ cents, currency = 'USD', size = 'sm', className }: { cents: number; currency?: string; size?: 'sm' | 'lg'; className?: string }) {
  const amount = stampAmount(cents, currency);
  return (
    <span className={`hold-stamp ${className ?? ''}`} data-size={size} role="img" aria-label={`${amount} hold`}>
      <span aria-hidden>{amount}</span>
    </span>
  );
}

/**
 * A postmark, drawn as an object from the post office: a double ring with text on its arcs, the state in
 * the middle and four cancellation waves. Decorative; the same facts are always written out as text nearby.
 */
export function Postmark({ tone, top, main, bottom, date, id }: { tone: Tone; top: string; main: string; bottom: string; date?: string; id: string }) {
  return (
    <svg aria-hidden viewBox="0 0 210 124" className={`w-[184px] shrink-0 -rotate-6 sm:w-[210px] ${TONE_TEXT[tone]}`} fill="none">
      <defs>
        <path id={`${id}-top`} d="M 19,62 A 43,43 0 0 1 105,62" />
        <path id={`${id}-bottom`} d="M 13,62 A 49,49 0 0 0 111,62" />
      </defs>
      <circle cx="62" cy="62" r="54" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="62" cy="62" r="38" stroke="currentColor" strokeWidth="1.25" />
      <text fill="currentColor" fontSize="9" fontWeight="600" letterSpacing="1.6" className="font-sans">
        <textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">
          {top.toUpperCase()}
        </textPath>
      </text>
      <text fill="currentColor" fontSize="9" fontWeight="600" letterSpacing="1.6" className="font-sans">
        <textPath href={`#${id}-bottom`} startOffset="50%" textAnchor="middle">
          {bottom.toUpperCase()}
        </textPath>
      </text>
      <text x="62" y={date ? 64 : 67} textAnchor="middle" fill="currentColor" fontSize={main.length > 9 ? 10 : main.length > 7 ? 11.5 : 15} fontWeight="700" letterSpacing="0.8" className="font-sans">
        {main.toUpperCase()}
      </text>
      {date ? (
        <text x="62" y="78" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="500" letterSpacing="0.6" className="font-mono">
          {date.toUpperCase()}
        </text>
      ) : null}
      {[34, 50, 66, 82].map((y) => (
        <path key={y} d={`M 122,${y} q 11,-7 22,0 t 22,0 t 22,0 t 22,0`} stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      ))}
    </svg>
  );
}
