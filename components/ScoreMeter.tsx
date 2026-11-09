/** A labelled 0–100 meter. The number is always shown as text; the bar is decoration. */
export function ScoreMeter({ label, value, kind, reason }: { label: string; value: number; kind: 'fit' | 'risk'; reason: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  let color = 'bg-good';
  let word = '';
  if (kind === 'risk') {
    color = v >= 70 ? 'bg-bad' : v >= 40 ? 'bg-held' : 'bg-good';
    word = v >= 70 ? 'High' : v >= 40 ? 'Medium' : 'Low';
  } else {
    color = v >= 60 ? 'bg-good' : v >= 35 ? 'bg-held' : 'bg-ink-3';
    word = v >= 60 ? 'Strong' : v >= 35 ? 'Partial' : 'Weak';
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className="font-mono text-ink-2 tabular-nums">
          {word} · {v}
        </span>
      </div>
      <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(v, 3)}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-3">{reason}</p>
    </div>
  );
}
