import { TONE_DOT } from '@/components/StateBadge';

/** How a hold moves, drawn from the real state names in lib/holds/machine.ts. */

const OUTCOMES = [
  {
    when: 'You reply, or mark it worth it',
    result: 'Released. The sender pays $0',
    states: 'AUTHORIZED → VOIDED',
    tone: 'good' as const,
  },
  {
    when: 'Nobody decides before your window ends',
    result: 'Released automatically. The sender pays $0',
    states: 'AUTHORIZED → VOIDED',
    tone: 'good' as const,
  },
  {
    when: 'You mark it spam',
    result: 'Captured and donated to your charity. You get $0',
    states: 'AUTHORIZED → CAPTURED → DONATED',
    tone: 'donated' as const,
  },
];

export function MoneyPath() {
  return (
    <ol className="grid overflow-hidden rounded-2xl border border-line bg-line [gap:1px] lg:grid-cols-[1fr_1fr_1.5fr]">
      <li className="bg-card p-6">
        <span className="font-mono text-[12px] text-ink-3">01</span>
        <h3 className="mt-3 text-[18px] leading-7 font-medium text-balance">The sender approves a hold</h3>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">
          They write to your page and approve a small hold in PayPal. It is an authorization, so nothing is charged.
        </p>
        <p translate="no" className="mt-4 font-mono text-[12px] text-ink-3">
          DRAFT → APPROVED → AUTHORIZED
        </p>
      </li>
      <li className="bg-card p-6">
        <span className="font-mono text-[12px] text-ink-3">02</span>
        <h3 className="mt-3 text-[18px] leading-7 font-medium text-balance">The AI sorts it, you decide</h3>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">
          A fit score, a scam risk score, a one-line summary and a draft reply arrive with the message. The AI has no way to move money.
        </p>
        <p className="mt-4 font-mono text-[12px] text-ink-3">
          <span translate="no">AUTHORIZED</span>, untouched
        </p>
      </li>
      <li className="bg-card p-6">
        <span className="font-mono text-[12px] text-ink-3">03</span>
        <h3 className="mt-3 text-[18px] leading-7 font-medium text-balance">It ends one of three ways</h3>
        <ul className="mt-4 grid gap-4">
          {OUTCOMES.map((o) => (
            <li key={o.when} className="grid grid-cols-[12px_1fr] gap-3">
              <span aria-hidden className={`mt-2 size-2 rounded-full ${TONE_DOT[o.tone]}`} />
              <div>
                <p className="text-[15px] leading-6 text-ink-2">{o.when}</p>
                <p className="text-[15px] leading-6 font-medium text-ink">{o.result}</p>
                <p translate="no" className="mt-1 font-mono text-[12px] text-ink-3">
                  {o.states}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </li>
    </ol>
  );
}
