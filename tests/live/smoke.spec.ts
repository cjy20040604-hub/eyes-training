import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Post-deploy smoke tests: the live site, as a first-time visitor gets it.
 * HTML is requested with a unique query string so the CDN cannot serve a stale copy from
 * before this deploy (hashed assets are immutable, so only the HTML needs this).
 */

const expectedVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const bust = `?smoke=${process.env.GITHUB_SHA ?? Date.now()}`;

function origin(page: Page): string {
  return new URL(page.url()).origin;
}

async function openFresh(page: Page) {
  await page.goto(bust);
  await expect(page.getByTestId('accept-disclaimer')).toBeVisible();
}

async function acceptDisclaimer(page: Page) {
  for (const id of ['ack-1', 'ack-2', 'ack-3', 'ack-4']) await page.getByTestId(id).check();
  await page.getByTestId('accept-disclaimer').click();
}

test('the deployed version loads with no errors and talks to no other site', async ({ page }) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith(origin(page)) && !r.url().startsWith('data:')) foreign.push(r.url());
  });
  await openFresh(page);
  await acceptDisclaimer(page);
  await expect(page.getByRole('heading', { name: "Today's training" })).toBeVisible();
  // Pages that load on demand come from the same sub-path.
  for (const [hash, heading] of [
    ['#/report', 'Summary for your clinician'],
    ['#/calibration', 'Calibration wizard'],
    ['#/history', 'History'],
    ['#/settings', 'Settings'],
  ] as const) {
    await page.goto(`${bust}${hash}`);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
  await expect(page.getByTestId('error-log-count')).toContainText(`app version ${expectedVersion}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  expect(foreign).toEqual([]);
});

test('end-to-end test hooks are not shipped', async ({ page }) => {
  await openFresh(page);
  expect(await page.evaluate(() => '__bvProbe' in window)).toBe(false);
});

test('the anti-framing guard is active on the live site', async ({ page, baseURL }) => {
  await openFresh(page);
  await expect(page.locator('html')).toHaveAttribute('data-frame-ok', '');
  await page.goto('about:blank');
  await page.setContent(
    `<iframe src="${baseURL}${bust}" width="800" height="600" title="embedded"></iframe>`,
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#frame-notice')).toBeVisible();
  await expect(frame.locator('#root')).toBeEmpty();
});

test('Chinese loads on demand and the app keeps working offline', async ({ page, context }) => {
  await openFresh(page);
  await acceptDisclaimer(page);
  await page.goto(`${bust}#/settings`);
  await page.getByRole('button', { name: '简体中文' }).click();
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
  // Once the service worker controls the page, everything is served from its cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto(`${bust}#/report`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(false);
});
