import type { Metadata } from 'next';
import { currentOwner } from '@/lib/auth';
import { getConfig, releaseOptions } from '@/lib/config';
import { SetupForm } from './SetupForm';

export const metadata: Metadata = { title: 'Create your page' };
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const owner = await currentOwner();
  const cfg = getConfig();
  const charities = cfg.charities.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb }));
  const windows = releaseOptions().map((o) => ({ minutes: o.minutes, label: o.label }));
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <p className="eyebrow">{owner ? 'Settings' : 'Create your page'}</p>
      <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight">{owner ? `Settings for @${owner.handle}` : 'Set the price of a cold message'}</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        Strangers will see these terms before they write. Stamp never pays you: holds are released, or, for spam, donated to the charity you
        pick.
      </p>
      <SetupForm
        mode={owner ? 'edit' : 'create'}
        charities={charities}
        windows={windows}
        initial={
          owner
            ? {
                handle: owner.handle,
                displayName: owner.displayName,
                bio: owner.bio,
                holdDollars: owner.holdCents / 100,
                topics: owner.topics.join(', '),
                freeLane: owner.freeLane.join('\n'),
                releaseMinutes: owner.releaseMinutes,
                charityId: owner.charityId,
              }
            : null
        }
      />
    </div>
  );
}
