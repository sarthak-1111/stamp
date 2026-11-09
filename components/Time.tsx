'use client';

import { useEffect, useState } from 'react';

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtRelative(ms: number): string {
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 5) return 'just now';
  if (Math.abs(s) < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
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

/** Absolute time on the server, relative ("12s ago") after hydration; exact time in the tooltip. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(5000);
  return (
    <time dateTime={iso} title={fmtAbsolute(iso)} className={className} suppressHydrationWarning>
      {now === null ? fmtAbsolute(iso) : fmtRelative(now - Date.parse(iso))}
    </time>
  );
}

export function AbsoluteTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {fmtAbsolute(iso)}
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

/** Live countdown to the auto-release time. */
export function Countdown({ until, prefix = 'Auto-releases in', onElapsed }: { until: string; prefix?: string; onElapsed?: () => void }) {
  const now = useNow(1000);
  const left = now === null ? null : Date.parse(until) - now;
  useEffect(() => {
    if (left !== null && left <= 0 && onElapsed) onElapsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left !== null && left <= 0]);
  if (left === null) return <span suppressHydrationWarning>{prefix} …</span>;
  if (left <= 0) return <span>Window ended: releasing</span>;
  return (
    <span suppressHydrationWarning>
      {prefix} <span className="font-mono tabular-nums">{fmtDuration(left)}</span>
    </span>
  );
}
