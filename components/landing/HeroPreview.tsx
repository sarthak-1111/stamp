import { ShieldWarning } from '@phosphor-icons/react/ssr';
import { ICON, REC_COPY, SenderLine, TriagePanel } from '@/components/Message';
import { HoldStamp, StateBadge } from '@/components/StateBadge';
import { PREVIEW_RECIPIENT, previewMessages } from '@/lib/preview';
import { stampAmount } from '@/lib/money';
import { BigStamp } from './BigStamp';

/**
 * The hero visual: Maya's inbox, built from the same components as the real inbox, with the rendered
 * stamp overlapping the window. The example people are invented; the triage shown is real output.
 */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function HeroPreview() {
  const [legit, spam] = previewMessages();
  if (!legit || !spam) return null;
  const amount = stampAmount(legit.holdCents);
  const spamRec = REC_COPY[spam.triage.recommendation];
  return (
    <figure className="relative mx-auto w-full max-w-[640px] pt-[132px] sm:pt-[148px]">
      <figcaption className="sr-only">
        Example of an inbox on Stamp: two strangers each placed a {amount} hold. The AI suggests replying to one and flags the other as a
        prompt-injection attempt. The holds do not change until Maya decides.
      </figcaption>
      <div className="overflow-hidden rounded-[20px] border border-line bg-card shadow-[var(--shadow-lg)]">
        <div className="flex h-12 items-center gap-3 border-b border-line px-5">
          <span className="text-[14px] font-medium">Inbox</span>
          <span className="font-mono text-[12px] text-ink-3">
            @{PREVIEW_RECIPIENT.handle}
            <span className="max-sm:hidden"> · 2 to decide</span>
          </span>
        </div>
        <div className="grid gap-3 bg-paper p-3 sm:p-4">
          <article className="rounded-[14px] border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <SenderLine name={legit.senderName} email={legit.senderEmail} />
              <HoldStamp cents={legit.holdCents} />
            </div>
            <h3 className="mt-2 text-[16px] leading-6 font-medium">{legit.subject}</h3>
            <p className="font-mono text-[12px] leading-4 text-ink-3">Auto-releases in {legit.releaseIn}</p>
            <div className="mt-3">
              <TriagePanel triage={legit.triage} footer={false} />
            </div>
            <div aria-hidden className="mt-3 flex flex-wrap gap-2">
              <span className="btn btn-primary btn-sm">Reply and release {amount}</span>
              <span className="btn btn-secondary btn-sm">Worth it</span>
              <span className="btn btn-danger btn-sm max-[420px]:hidden sm:ml-auto">Spam</span>
            </div>
          </article>

          <article className="rounded-[14px] border border-line bg-card p-4 max-sm:hidden">
            <div className="flex items-start justify-between gap-3">
              <SenderLine name={spam.senderName} email={spam.senderEmail} />
              <HoldStamp cents={spam.holdCents} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[16px] leading-6 font-medium">{spam.subject}</h3>
              {spamRec ? <StateBadge tone={spamRec.tone} label={`Suggests: ${spamRec.label}`} /> : null}
            </div>
            <p className="mt-2 flex gap-2 rounded-lg bg-bad-bg px-3 py-2 text-[13px] leading-5 text-bad">
              <ShieldWarning {...ICON} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Tried to instruct the AI: {spam.triage.flags.slice(0, 2).map(lowerFirst).join(', ')}. Ignored, and the hold did not change.
              </span>
            </p>
          </article>
        </div>
      </div>
      <BigStamp amount={amount} handle={PREVIEW_RECIPIENT.handle} className="absolute top-0 right-4 z-10 rotate-[5deg] sm:right-8" />
    </figure>
  );
}
