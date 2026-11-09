'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** The private key arrives in the URL fragment (never sent to servers or in Referer headers). */
export default function SignInPage() {
  const [state, setState] = useState<'working' | 'error' | 'missing'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (!key) {
      setState('missing');
      return;
    }
    history.replaceState(null, '', '/signin');
    void (async () => {
      const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => null);
      if (res?.ok) {
        window.location.replace('/inbox');
        return;
      }
      const j = res ? await res.json().catch(() => ({})) : {};
      setMessage(j.message ?? 'Network error.');
      setState('error');
    })();
  }, []);

  return (
    <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6" aria-live="polite">
      {state === 'working' ? <p className="text-[17px] leading-7 text-ink-2">Opening your inbox…</p> : null}
      {state === 'missing' ? (
        <>
          <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">Use your private link</h1>
          <p className="mt-3 text-[17px] leading-7 text-ink-2">Open the full private inbox link you saved when you created your page.</p>
        </>
      ) : null}
      {state === 'error' ? (
        <>
          <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">That link did not work</h1>
          <p className="mt-3 text-[17px] leading-7 text-ink-2">{message}</p>
          <Link className="btn btn-secondary mt-8" href="/">
            Back home
          </Link>
        </>
      ) : null}
    </div>
  );
}
