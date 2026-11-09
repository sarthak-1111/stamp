import Link from 'next/link';

export function StampMark({ size = 28 }: { size?: number }) {
  return (
    <span aria-hidden className="stamp-edge-sm inline-grid place-items-center" style={{ width: size, height: size }}>
      <span className="font-display text-[13px] leading-none font-semibold text-white">S</span>
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-md text-ink no-underline">
      <StampMark />
      <span className="font-display text-xl font-semibold tracking-tight">Stamp</span>
    </Link>
  );
}
