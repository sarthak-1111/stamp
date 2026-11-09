import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` throws outside React Server Components; tests run lib code directly.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    env: {
      STAMP_DB: 'memory',
      APP_URL: 'http://localhost:3000',
      PAYPAL_CLIENT_ID: 'test-client',
      PAYPAL_CLIENT_SECRET: 'test-secret',
      CHARITY_PAYPAL_EMAIL: 'charity@example.test',
      SESSION_SECRET: 'test-session-secret-test-session-secret',
      AI_BASE_URL: '',
    },
  },
});
