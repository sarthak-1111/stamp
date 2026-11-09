import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 pt-20 text-center sm:px-6">
      <p className="eyebrow">404</p>
      <h1 className="font-display mt-3 text-4xl font-semibold">Return to sender</h1>
      <p className="mt-3 text-ink-2">There is no page at this address.</p>
      <Link href="/" className="btn btn-ghost mt-8">
        Back home
      </Link>
    </div>
  );
}
