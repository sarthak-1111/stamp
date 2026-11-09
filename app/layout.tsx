import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { MotionProvider } from '@/components/Motion';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { appUrl } from '@/lib/config';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const DESCRIPTION =
  'Strangers put a small refundable PayPal hold on the line to reach you. Real messages get it back. Spam is donated to charity, never paid to you. PayPal sandbox demo.';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: 'Stamp: a refundable stamp for cold messages', template: '%s · Stamp' },
  description: DESCRIPTION,
  openGraph: { type: 'website', siteName: 'Stamp', title: 'Stamp: strangers can reach you, spam pays a charity', description: DESCRIPTION },
  twitter: { card: 'summary_large_image' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#141415' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans text-[16px] leading-relaxed antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <MotionProvider>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </MotionProvider>
      </body>
    </html>
  );
}
