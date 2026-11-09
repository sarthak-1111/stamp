import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

// Next.js needs inline scripts for hydration; everything else is same-origin. No third-party scripts.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['@electric-sql/pglite', '@paypal/agent-toolkit', '@modelcontextprotocol/sdk'],
  async rewrites() {
    return [{ source: '/@:handle', destination: '/u/:handle' }];
  },
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ];
    if (isProd) {
      security.push({ key: 'Content-Security-Policy', value: csp });
      security.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
    }
    return [{ source: '/:path*', headers: security }];
  },
};

export default nextConfig;
