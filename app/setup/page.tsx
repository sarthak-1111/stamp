import type { Metadata } from 'next';
import { currentOwner } from '@/lib/auth';
import { releaseOptions, getConfig } from '@/lib/config';
import { SetupForm } from './SetupForm';

export const metadata: Metadata = { title: 'Create your page' };
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const owner = await currentOwner();
  const cfg = getConfig();
  const charities = cfg.charities.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb }));
  const windows = releaseOptions().map((o) => ({ minutes: o.minutes, label: o.label }));
  return (
    <div className="rise mx-auto max-w-[880px] px-4 pt-10 sm:px-6 sm:pt-16">
      <h1 className="text-[36px] leading-[1.1] font-medium tracking-[-0.02em] text-balance sm:text-[44px]">
        {owner ? `Settings for @${owner.handle}` : 'Set the price of a cold message'}
      </h1>
      <p className="mt-4 max-w-2xl text-[17px] leading-7 text-ink-2">
        Strangers see these terms before they write. Stamp never pays you: holds are released, or, for spam, donated to the charity you pick.
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
