import 'server-only';
import { after } from 'next/server';

/**
 * Work that should not block the response (AI triage). Inside a Next.js request it runs via `after()`,
 * which keeps the serverless function alive until the task finishes. Outside a request (tests,
 * scripts) the task runs immediately and can be awaited with drainBackground().
 */
const inFlight = new Set<Promise<void>>();

export function runInBackground(task: () => Promise<void>): void {
  const wrapped = async () => {
    try {
      await task();
    } catch (err) {
      console.error('[stamp] background task failed:', err);
    }
  };
  try {
    after(wrapped);
    return;
  } catch {
    // not inside a request scope
  }
  const p: Promise<void> = wrapped().finally(() => inFlight.delete(p));
  inFlight.add(p);
}

export async function drainBackground(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}
