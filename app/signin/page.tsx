'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

/** Accepts the full private link (…/signin#key=…) or the bare key. */
function keyFrom(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const hash = v.indexOf('#');
  if (hash !== -1) return new URLSearchParams(v.slice(hash + 1)).get('key');
  return /^rcp_[\w.-]+$/.test(v) ? v : null;
}

async function openInbox(key: string): Promise<string | null> {
  const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => null);
  if (res?.ok) {
    window.location.replace('/inbox');
    return null;
  }
  const j = res ? await res.json().catch(() => ({})) : {};
  return j.message ?? 'Network error. Nothing was changed. Try again.';
}

/** The private key arrives in the URL fragment, which browsers never send to servers or in Referer headers. */
export default function SignInPage() {
  const [state, setState] = useState<'working' | 'form'>('working');
  const [error, setError] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (!key) {
      setState('form');
      return;
    }
    history.replaceState(null, '', '/signin');
    void openInbox(key).then((err) => {
      if (err) {
        setError(err);
        setState('form');
      }
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const key = keyFrom(value);
    if (!key) {
      setError('Paste the whole private link, the one that ends with #key=…');
      return;
    }
    setBusy(true);
    const err = await openInbox(key);
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (state === 'working') {
    return (
      <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6" aria-live="polite">
        <p className="text-[17px] leading-7 text-ink-2">Opening your inbox…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pt-16 pb-24 sm:px-6">
      <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">Open your inbox</h1>
      <p className="mt-3 text-[17px] leading-7 text-ink-2">
        Your inbox has no password. It opens with the private link you saved when you created your page.
      </p>
      <form onSubmit={onSubmit} className="card mt-8 p-6" noValidate>
        <label htmlFor="private-link" className="block text-[14px] leading-5 font-medium">
          Private link
        </label>
        <input
          id="private-link"
          name="private-link"
          className="field mt-2 font-mono text-[14px]"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder="https://…/signin#key=…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'private-link-error' : 'private-link-help'}
        />
        {error ? (
          <p id="private-link-error" role="alert" className="mt-2 text-[14px] leading-5 text-bad">
            {error}
          </p>
        ) : (
          <p id="private-link-help" className="mt-2 text-[14px] leading-5 text-ink-3">
            Keep this link private: anyone who has it can open your inbox.
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Opening…' : 'Open inbox'}
          </button>
          <Link href="/setup" className="btn btn-quiet">
            Create a page instead
          </Link>
        </div>
      </form>
    </div>
  );
}
