import 'server-only';

/**
 * Runtime configuration, read from environment variables.
 * Stamp is SANDBOX ONLY: the PayPal base URL is hard-coded to the sandbox and the app refuses to
 * start if anything asks for live.
 */

export const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';

export type Charity = { id: string; name: string; email: string; blurb: string };

export type ReleaseOption = { minutes: number; label: string; demo?: boolean };

/** Auto-release windows. All end within PayPal's 3-day honor period (72 h at most; see API_NOTES.md §1). */
export const RELEASE_OPTIONS: ReleaseOption[] = [
  { minutes: 3, label: '3 minutes (demo)', demo: true },
  { minutes: 10, label: '10 minutes (demo)', demo: true },
  { minutes: 60, label: '1 hour' },
  { minutes: 12 * 60, label: '12 hours' },
  { minutes: 24 * 60, label: '24 hours' },
  { minutes: 48 * 60, label: '48 hours' },
  { minutes: 72 * 60, label: '72 hours' },
];
export const MAX_RELEASE_MINUTES = 72 * 60;
export const DEFAULT_RELEASE_MINUTES = 48 * 60;

export const HOLD_MIN_CENTS = 100;
export const HOLD_MAX_CENTS = 2000;
export const CURRENCY = 'USD';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function appUrl(): string {
  const explicit = env('APP_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const prod = env('VERCEL_PROJECT_PRODUCTION_URL');
  if (prod) return `https://${prod}`;
  const preview = env('VERCEL_URL');
  if (preview) return `https://${preview}`;
  return 'http://localhost:3000';
}

export function getConfig() {
  const paypalEnv = env('PAYPAL_ENV') || 'sandbox';
  if (paypalEnv !== 'sandbox') {
    throw new Error('Stamp is sandbox-only: PAYPAL_ENV must be "sandbox" (or unset).');
  }
  const isProd = process.env.NODE_ENV === 'production';
  const sessionSecret = env('SESSION_SECRET') || (isProd ? '' : 'dev-only-session-secret-change-me');
  if (!sessionSecret) throw new Error('SESSION_SECRET must be set in production.');

  const charityEmail = env('CHARITY_PAYPAL_EMAIL');
  const charities: Charity[] = charityEmail
    ? [
        {
          id: 'demo-charity',
          name: env('CHARITY_NAME') || 'Demo Charity (PayPal sandbox)',
          email: charityEmail,
          blurb:
            'A PayPal sandbox business account standing in for a vetted charity. In this demo it receives every captured hold.',
        },
      ]
    : [];

  return {
    isProd,
    appUrl: appUrl(),
    paypal: {
      env: 'sandbox' as const,
      apiBase: PAYPAL_SANDBOX_API,
      clientId: env('PAYPAL_CLIENT_ID'),
      clientSecret: env('PAYPAL_CLIENT_SECRET'),
      webhookId: env('PAYPAL_WEBHOOK_ID'),
    },
    charities,
    ai: {
      baseUrl: env('AI_BASE_URL').replace(/\/+$/, ''),
      apiKey: env('AI_API_KEY'),
      model: env('AI_MODEL') || 'gpt-oss:120b',
      timeoutMs: Number(env('AI_TIMEOUT_MS')) || 45_000,
      label: env('AI_LABEL') || '',
    },
    sessionSecret,
    cronSecret: env('CRON_SECRET'),
    /** Minutes after which a checkout that was never approved is given up on. */
    abandonMinutes: Number(env('ABANDON_MINUTES')) || 120,
    allowDemoWindows: env('ALLOW_DEMO_WINDOWS') !== 'false',
  };
}

export type Config = ReturnType<typeof getConfig>;

export function getCharity(id: string): Charity | undefined {
  return getConfig().charities.find((c) => c.id === id);
}

export function releaseOptions(): ReleaseOption[] {
  const { allowDemoWindows } = getConfig();
  return RELEASE_OPTIONS.filter((o) => allowDemoWindows || !o.demo);
}

export function aiEnabled(): boolean {
  return Boolean(getConfig().ai.baseUrl);
}
