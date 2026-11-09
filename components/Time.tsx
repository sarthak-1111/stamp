'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Times are rendered twice: during server rendering and hydration they show a fixed UTC form (the
 * server's clock and time zone are not the reader's), then, once hydrated, the reader's local time.
 * Both renders are deterministic, so there is no hydration mismatch to suppress.
 */
const noop = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const PARTS = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
const utcFormat = new Intl.DateTimeFormat('en-US', { ...PARTS, timeZone: 'UTC' });
let localFormat: Intl.DateTimeFormat | null = null;
let localDetailed: Intl.DateTimeFormat | null = null;
let relative: Intl.RelativeTimeFormat | null = null;

export function fmtUtc(iso: string): string {
  return `${utcFormat.format(new Date(iso))} UTC`;
}
export function fmtLocal(iso: string, seconds = false): string {
  if (seconds) {
    localDetailed ??= new Intl.DateTimeFormat(undefined, { ...PARTS, second: '2-digit' });
    return localDetailed.format(new Date(iso));
  }
  localFormat ??= new Intl.DateTimeFormat(undefined, PARTS);
  return localFormat.format(new Date(iso));
}

function fmtRelative(ms: number): string {
  relative ??= new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 5) return relative.format(0, 'second');
  if (Math.abs(s) < 60) return relative.format(-s, 'second');
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return relative.format(-m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return relative.format(-h, 'hour');
  return relative.format(-Math.round(h / 24), 'day');
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** UTC while hydrating, then relative ("12 seconds ago") with the exact local time in the tooltip. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(5000);
  return (
    <time dateTime={iso} title={now === null ? fmtUtc(iso) : fmtLocal(iso, true)} className={className}>
      {now === null ? fmtUtc(iso) : fmtRelative(now - Date.parse(iso))}
    </time>
  );
}

/** UTC while hydrating, then the reader's local date and time with seconds. */
export function AbsoluteTime({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? fmtLocal(iso, true) : fmtUtc(iso)}
    </time>
  );
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Live countdown to the auto-release time. Keep it out of aria-live regions: it changes every second. */
export function Countdown({ until, prefix = 'Auto-releases in', onElapsed }: { until: string; prefix?: string; onElapsed?: () => void }) {
  const now = useNow(1000);
  const left = now === null ? null : Date.parse(until) - now;
  useEffect(() => {
    if (left !== null && left <= 0 && onElapsed) onElapsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left !== null && left <= 0]);
  if (left === null) return <span>{prefix} …</span>;
  if (left <= 0) return <span>Window ended, releasing…</span>;
  return (
    <span>
      {prefix} <span className="font-mono tabular-nums">{fmtDuration(left)}</span>
    </span>
  );
}
