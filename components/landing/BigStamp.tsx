import { Postmark } from '@/components/StateBadge';

/**
 * The landing page's one rendered object: a postage stamp with real perforations, an engraved cobalt
 * face and a postmark that says the money is held, not charged. Decorative; the hero copy says the same.
 */
export function BigStamp({ amount = '$5', handle = 'maya', className = '' }: { amount?: string; handle?: string; className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none select-none ${className}`}>
      <div className="relative">
        <div
          className="perforated w-[148px] sm:w-[164px]"
          style={
            {
              '--r': '6px',
              '--perf-margin': '5px',
              '--perf-paper': '#ffffff',
              filter: 'drop-shadow(0 16px 24px rgb(16 16 24 / 0.16)) drop-shadow(0 1px 1px rgb(16 16 24 / 0.14))',
            } as React.CSSProperties
          }
        >
          <div className="engraving relative flex aspect-[4/5] flex-col justify-between rounded-[2px] p-3 text-white">
            <span className="absolute inset-1.5 rounded-[1px] border border-white/40" />
            <div className="relative flex items-center justify-between font-mono text-[10px] leading-3 tracking-[0.06em] text-white/85">
              <span>REFUNDABLE</span>
              <span>USD</span>
            </div>
            <div className="relative text-[60px] leading-none font-medium tracking-[-0.04em] sm:text-[68px]">{amount}</div>
            <div className="relative font-mono text-[10px] leading-3 text-white/85">to reach @{handle}</div>
          </div>
        </div>
        <div className="absolute top-2 -left-36 opacity-80 mix-blend-multiply sm:-left-40 dark:opacity-70 dark:mix-blend-normal">
          <Postmark id="hero-postmark" tone="neutral" top="Held, not charged" main="Held" bottom="Stamp sandbox" />
        </div>
      </div>
    </div>
  );
}
