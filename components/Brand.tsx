import Link from 'next/link';

/** The mark: a tiny perforated stamp in ink, with a hairline frame. Flat, one colour. */
export function StampMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="perforated inline-block shrink-0"
      style={{ '--r': '1.5px', '--perf-paper': 'var(--ink)', '--perf-margin': '0px', width: size, height: size } as React.CSSProperties}
    >
      <span className="block size-full rounded-[1px] border border-paper/70" />
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-md text-ink no-underline">
      <StampMark />
      <span className="text-[17px] font-semibold tracking-[-0.01em]">Stamp</span>
    </Link>
  );
}
