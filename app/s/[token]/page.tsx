import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStatusView } from '@/lib/views';
import { StatusLive } from './StatusLive';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Message status', referrer: 'no-referrer' };

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getStatusView(token);
  if (!view) notFound();
  return (
    <div className="rise mx-auto max-w-[880px] px-4 pt-10 sm:px-6 sm:pt-16">
      <StatusLive initial={view} />
    </div>
  );
}
