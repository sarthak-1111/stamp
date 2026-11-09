import 'server-only';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';
import { verifyOwnerKey, type Recipient } from '@/lib/recipients';

/**
 * No accounts and no passwords: creating a page returns a private owner key (shown once, stored only
 * as a SHA-256 hash). The key lives in an httpOnly cookie; a private sign-in link carries it in the URL
 * fragment, which browsers never send to the server or in Referer headers.
 */
export const OWNER_COOKIE = 'stamp_owner';

export async function currentOwner(): Promise<Recipient | null> {
  const jar = await cookies();
  return verifyOwnerKey(jar.get(OWNER_COOKIE)?.value);
}

export async function setOwnerCookie(key: string): Promise<void> {
  const jar = await cookies();
  jar.set(OWNER_COOKIE, key, {
    httpOnly: true,
    secure: getConfig().isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  });
}

export async function clearOwnerCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(OWNER_COOKIE);
}
