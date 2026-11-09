import { ShieldWarning } from '@phosphor-icons/react/ssr';
import type { InboxCard } from '@/lib/views';
import { ScoreMeter } from './ScoreMeter';
import { StateBadge } from './StateBadge';

/** Shared pieces of a message card. Used by the inbox and by the product preview on the landing page. */

export type TriageData = NonNullable<InboxCard['triage']>;

export const ICON = { size: 16, weight: 'bold' } as const;

export const REC_COPY: Record<string, { label: string; tone: 'good' | 'held' | 'bad' | 'neutral' }> = {
  reply: { label: 'Worth a reply', tone: 'good' },
  worth_it: { label: 'Not spam, release it', tone: 'good' },
  review: { label: 'Check carefully', tone: 'held' },
  spam: { label: 'Looks like spam', tone: 'bad' },
};

export function SenderLine({ name, email, note }: { name: string; email: string; note?: string | null }) {
  return (
    <p className="min-w-0 text-[14px] leading-5 text-ink-2">
      <span className="font-medium text-ink">{name}</span> <span className="break-all text-ink-3">{email}</span>
      {note ? <span className="mt-1 block text-[13px] text-ink-3">{note}</span> : null}
    </p>
  );
}

export function TriagePanel({ triage: t, footer = true }: { triage: TriageData; footer?: boolean }) {
  const rec = REC_COPY[t.recommendation];
  const flags = [...new Set(t.flags.map((f) => f.charAt(0).toUpperCase() + f.slice(1)))];
  return (
    <section aria-label="AI triage" className="well p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] leading-5 text-ink-3">AI triage</span>
        {rec ? <StateBadge tone={rec.tone} label={`Suggests: ${rec.label}`} /> : null}
      </div>
      <p className="mt-2 text-[15px] leading-6 text-ink">{t.summary}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ScoreMeter label="Fit with your topics" value={t.fitScore} kind="fit" reason={t.fitReason} />
        <ScoreMeter label="Scam or phishing risk" value={t.riskScore} kind="risk" reason={t.riskReason} />
      </div>
      {t.injection ? (
        <p className="mt-4 flex gap-2 rounded-lg bg-bad-bg px-3 py-2 text-[14px] leading-5 text-bad">
          <ShieldWarning {...ICON} className="mt-0.5 shrink-0" aria-hidden />
          <span>This message tried to give the AI instructions. They were ignored and the hold did not change.</span>
        </p>
      ) : null}
      {flags.length ? (
        // Stamp's deterministic flags come first; the model's often restate them in other words, so only
        // the first three are shown. Neutral tags: the risk meter and the banner already carry the red.
        <ul className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Red flags">
          {flags.slice(0, 3).map((f) => (
            <li key={f} className="tag text-[12px] leading-[18px]">
              {f}
            </li>
          ))}
          {flags.length > 3 ? <li className="font-mono text-[12px] leading-[18px] text-ink-3">+{flags.length - 3} more</li> : null}
        </ul>
      ) : null}
      {footer ? (
        <p className="mt-3 font-mono text-[12px] leading-4 text-ink-3">
          {t.source === 'model' ? `${t.model ?? 'model'}${t.latencyMs ? `, ${(t.latencyMs / 1000).toFixed(1)}s` : ''}` : 'rule-based triage'}
          {t.source === 'rules' && t.modelError ? ' (model unavailable)' : ''}
          {' · a suggestion, you decide'}
        </p>
      ) : null}
    </section>
  );
}
