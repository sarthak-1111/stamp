import { useFreshTestDb, type Db } from '@/lib/db';
import { setPayPalTransport } from '@/lib/paypal/client';
import { setOrderReader } from '@/lib/paypal/toolkit';
import { createRecipient } from '@/lib/recipients';
import { FakePayPal } from './fake-paypal';

export async function setup(): Promise<{ db: Db; paypal: FakePayPal }> {
  const db = await useFreshTestDb();
  const paypal = new FakePayPal();
  setPayPalTransport(paypal.transport);
  setOrderReader('rest');
  return { db, paypal };
}

export async function makeRecipient(handle = 'ana', overrides: Partial<Parameters<typeof createRecipient>[1]> = {}) {
  const created = await createRecipient(handle, {
    displayName: 'Ana Ruiz',
    bio: 'Climate founder',
    holdCents: 500,
    topics: ['climate tech', 'battery storage', 'hiring'],
    freeLane: ['@friends.example'],
    releaseMinutes: 60,
    charityId: 'demo-charity',
    ...overrides,
  });
  if (!created) throw new Error('handle taken');
  return created;
}

/** Move time forward for a hold by rewriting its release time in the database. */
export async function expireWindow(db: Db, holdId: string) {
  await db.query("UPDATE holds SET release_at = now() - interval '1 second' WHERE id = $1", [holdId]);
}

export async function makeStale(db: Db, holdId: string) {
  await db.query("UPDATE holds SET pending_since = now() - interval '5 minutes' WHERE id = $1", [holdId]);
}
