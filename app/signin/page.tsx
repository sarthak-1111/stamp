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
    <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6">
      <div className="card p-6 sm:p-8" aria-live="polite">
        {state === 'working' ? <p className="text-lg">Opening your inbox…</p> : null}
        {state === 'missing' ? (
          <>
            <h1 className="font-display text-2xl font-semibold">Use your private link</h1>
            <p className="mt-2 text-ink-2">Open the full private inbox link you saved when you created your page.</p>
          </>
        ) : null}
        {state === 'error' ? (
          <>
            <h1 className="font-display text-2xl font-semibold">That link didn’t work</h1>
            <p className="mt-2 text-ink-2">{message}</p>
            <Link className="btn btn-ghost mt-6" href="/">
              Back home
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
