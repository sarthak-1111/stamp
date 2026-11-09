import { ACTORS, OPERATIONS, type Actor, type Operation } from '@/lib/holds/machine';

/**
 * Who may start each money operation. Rendered straight from the OPERATIONS table that the server enforces,
 * so this page cannot drift from the code.
 */

const OPS: Array<{ op: Operation; label: string }> = [
  { op: 'authorize', label: 'Place hold' },
  { op: 'void', label: 'Release' },
  { op: 'capture', label: 'Capture' },
  { op: 'payout', label: 'Donate' },
];

const ACTOR_LABEL: Record<Actor, string> = {
  sender: 'Sender',
  recipient: 'You, the recipient',
  timer: 'Release timer',
  paypal: 'PayPal webhook',
  system: 'Reconciler',
  ai: 'AI model',
};

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
      <table className="w-full min-w-[520px] border-collapse text-left text-[14px] leading-5">
        <caption className="sr-only">Which actor may start each money operation</caption>
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th scope="col" className="px-4 py-3 font-normal">
              Who
            </th>
            {OPS.map((o) => (
              <th key={o.op} scope="col" className="px-4 py-3 font-normal">
                {o.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ACTORS.map((a) => {
            const isAi = a === 'ai';
            return (
              <tr key={a} className={`border-b border-line last:border-0 ${isAi ? 'bg-paper-2' : ''}`}>
                <th scope="row" className={`px-4 py-3 ${isAi ? 'font-medium text-ink' : 'font-normal text-ink-2'}`}>
                  {ACTOR_LABEL[a]}
                </th>
                {OPS.map((o) => {
                  const v = cell(o.op, a);
                  return (
                    <td key={o.op} className="px-4 py-3">
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
