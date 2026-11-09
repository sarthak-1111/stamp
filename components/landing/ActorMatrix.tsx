import { ACTORS, OPERATIONS, type Actor, type Operation } from '@/lib/holds/machine';

/**
 * Who may start each money operation. Rendered straight from the OPERATIONS table that the server enforces,
 * so this page cannot drift from the code.
 */

const OPS: Array<{ op: Operation; label: string; short: string }> = [
  { op: 'authorize', label: 'Place hold', short: 'Hold' },
  { op: 'void', label: 'Release', short: 'Release' },
  { op: 'capture', label: 'Capture', short: 'Capture' },
  { op: 'payout', label: 'Donate', short: 'Donate' },
];

// Short labels keep all five columns on a phone screen, so the AI row is never scrolled out of view.
const ACTOR_LABEL: Record<Actor, { label: string; short: string }> = {
  sender: { label: 'Sender', short: 'Sender' },
  recipient: { label: 'You, the recipient', short: 'You' },
  timer: { label: 'Release timer', short: 'Timer' },
  paypal: { label: 'PayPal webhook', short: 'Webhook' },
  system: { label: 'Reconciler', short: 'Reconciler' },
  ai: { label: 'AI model', short: 'AI model' },
};

function Label({ label, short }: { label: string; short: string }) {
  if (label === short) return <>{label}</>;
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </>
  );
}

const REASON_LABEL: Record<string, string> = {
  reply: 'Reply',
  worth_it: 'Worth it',
  auto_release: 'Window ends',
  spam: 'Spam',
};

function cell(op: Operation, actor: Actor): string | null {
  const rule = OPERATIONS.find((r) => r.op === op);
  const allowed = rule?.allow[actor];
  if (!allowed) return null;
  if (allowed === 'any') return op === 'authorize' && actor !== 'sender' ? 'After approval' : 'Approves';
  return allowed.map((r) => REASON_LABEL[r] ?? r).join(', ');
}

export function ActorMatrix() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full border-collapse text-left text-[13px] leading-5 sm:text-[14px]">
        <caption className="sr-only">Which actor may start each money operation</caption>
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th scope="col" className="px-2 py-3 font-normal first:pl-3 sm:px-4 sm:first:pl-4">
              Who
            </th>
            {OPS.map((o) => (
              <th key={o.op} scope="col" className="px-2 py-3 font-normal sm:px-4">
                <Label label={o.label} short={o.short} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ACTORS.map((a) => {
            const isAi = a === 'ai';
            return (
              <tr key={a} className={`border-b border-line last:border-0 ${isAi ? 'bg-paper-2' : ''}`}>
                <th scope="row" className={`py-3 pr-2 pl-3 sm:px-4 ${isAi ? 'font-medium text-ink' : 'font-normal text-ink-2'}`}>
                  <Label {...ACTOR_LABEL[a]} />
                </th>
                {OPS.map((o) => {
                  const v = cell(o.op, a);
                  return (
                    <td key={o.op} className="px-2 py-3 sm:px-4">
                      {v ? <span className="text-ink">{v}</span> : <span className={isAi ? 'font-medium text-bad' : 'text-ink-3'}>No</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
