import { after } from 'next/server';
import { currentOwner } from '@/lib/auth';
import { maybeSweep, refreshHold } from '@/lib/holds/service';
import { errorResponse, json } from '@/lib/http';
import { ensureModelTriage } from '@/lib/triage/pipeline';
import { getInboxView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/** Polled by the inbox. Releases any hold whose window has ended before answering. */
export async function GET() {
  try {
    const owner = await currentOwner();
    if (!owner) return json({ error: 'unauthorized' }, 401);
    let view = await getInboxView(owner);
    const due = view.cards.filter((c) => c.hold?.state === 'AUTHORIZED' && c.hold.releaseAt && Date.parse(c.hold.releaseAt) <= Date.now());
    if (due.length) {
      for (const c of due.slice(0, 5)) if (c.holdId) await refreshHold(c.holdId);
      view = await getInboxView(owner);
    }
    after(async () => {
      await ensureModelTriage(view.cards.filter((c) => c.triage?.source === 'rules').map((c) => c.messageId));
      await maybeSweep();
    });
    return json(view);
  } catch (err) {
    return errorResponse(err);
  }
}
