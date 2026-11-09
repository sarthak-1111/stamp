/**
 * A tiny HTTP client for Stamp's own API, used by the demo and E2E scripts.
 * It talks to a running Stamp (local or deployed) exactly like the browser does,
 * including the owner cookie, so the scripts exercise the real routes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Gitignored: private owner keys for pages the scripts created. Never commit this folder. */
export const DEMO_DIR = join(ROOT, '.demo');

export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export function baseUrl() {
  const raw = arg('base') || process.env.STAMP_URL || process.env.APP_URL || 'http://localhost:3000';
  return String(raw).replace(/\/+$/, '');
}

export function saveKey(handle, data) {
  mkdirSync(DEMO_DIR, { recursive: true });
  writeFileSync(join(DEMO_DIR, `${handle}.json`), JSON.stringify(data, null, 2));
}

export function loadKey(handle) {
  const p = join(DEMO_DIR, `${handle}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function stampClient(base) {
  let cookie = '';
  async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set && set.startsWith('stamp_owner=')) cookie = set.split(';')[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: res.status, json };
  }
  return {
    call,
    get: (path) => call('GET', path),
    post: (path, body, headers) => call('POST', path, body, headers),
    put: (path, body) => call('PUT', path, body),
    /** Sign in as the page owner with the private key (what /signin#key=… does). */
    async signIn(key) {
      const r = await call('POST', '/api/session', { key });
      if (r.status !== 200) throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.json)}`);
      return r.json;
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() returns a truthy value or the deadline passes. */
export async function waitFor(fn, { timeoutMs, everyMs = 3000, onTick } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    onTick?.();
    await sleep(everyMs);
  }
}
