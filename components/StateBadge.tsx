import type { HoldView } from '@/lib/views';

type Tone = HoldView['tone'];

const TONES: Record<Tone, string> = {
  neutral: 'bg-paper-2 text-ink-2 border-line',
  held: 'bg-held-bg text-held border-held/25',
  good: 'bg-good-bg text-good border-good/25',
  donated: 'bg-donated-bg text-donated border-donated/25',
  bad: 'bg-bad-bg text-bad border-bad/25',
};

export function toneClasses(tone: Tone): string {
  return TONES[tone];
}

/** Small pill: "● Held, not charged". The label always carries the meaning; colour only reinforces it. */
export function StateBadge({ tone, label, busy = false }: { tone: Tone; label: string; busy?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${TONES[tone]}`}>
      <span aria-hidden className={`size-1.5 rounded-full bg-current ${busy ? 'pulse' : ''}`} />
      {label}
    </span>
  );
}

/** Large, slightly rotated postmark for the status page. */
export function Postmark({ tone, top, main, bottom }: { tone: Tone; top: string; main: string; bottom?: string }) {
  const color: Record<Tone, string> = {
    neutral: 'text-ink-3',
    held: 'text-held',
    good: 'text-good',
    donated: 'text-donated',
    bad: 'text-bad',
  };
  return (
    <div aria-hidden className={`postmark grid size-36 shrink-0 -rotate-6 place-items-center text-center ${color[tone]} sm:size-40`}>
      <div className="px-3">
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase">{top}</div>
        <div className="font-display my-1 text-2xl leading-none font-semibold">{main}</div>
        {bottom ? <div className="text-[10px] font-bold tracking-[0.2em] uppercase">{bottom}</div> : null}
      </div>
    </div>
  );
}
