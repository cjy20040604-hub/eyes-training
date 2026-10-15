import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the deployed site (GitHub Pages), run by CI after each deploy:
 *   LIVE_URL=https://<user>.github.io/<repo>/ npx playwright test -c playwright.live.config.ts
 * No local server: this checks what users actually get (sub-path, caching, headers).
 */
const liveUrl = process.env.LIVE_URL ?? 'https://cjy20040604-hub.github.io/eyes-training/';

export default defineConfig({
  testDir: 'tests/live',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: liveUrl.endsWith('/') ? liveUrl : `${liveUrl}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
