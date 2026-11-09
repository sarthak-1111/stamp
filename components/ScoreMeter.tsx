/** A labelled 0 to 100 meter. The number and the word are always shown as text; the bar is decoration. */
export function ScoreMeter({ label, value, kind, reason }: { label: string; value: number; kind: 'fit' | 'risk'; reason: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  let color = 'bg-ink-2';
  let word: string;
  if (kind === 'risk') {
    color = v >= 70 ? 'bg-bad' : v >= 40 ? 'bg-held' : 'bg-good';
    word = v >= 70 ? 'High' : v >= 40 ? 'Medium' : 'Low';
  } else {
    word = v >= 60 ? 'Strong' : v >= 35 ? 'Partial' : 'Weak';
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px] leading-5">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono text-[12px] text-ink-2 tabular-nums">
          {word} {v}
        </span>
      </div>
      <div aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(v, 3)}%` }} />
      </div>
      <p className="mt-2 text-[13px] leading-5 text-ink-3">{reason}</p>
    </div>
  );
}
