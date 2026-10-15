import { expect, test, type Page } from '@playwright/test';
import {
  LEFT_EYE_OFFSET_PX,
  ORIGIN,
  acceptDisclaimer,
  bundle,
  channelCentroid,
  importBundle,
  probePoint,
  unlockedHistory,
} from './helpers';

/**
 * Platform checks: what reaches the screen (each eye's image in its own colour channel, at
 * the calibrated offset), the anti-framing guard, the local error log, on-demand loading
 * of translations, and offline use of lazily loaded pages.
 */

test.use({ viewport: { width: 1100, height: 720 } });

async function startModule(page: Page, id: string) {
  await page.goto('/#/');
  const add = page.getByTestId(`add-${id}`);
  if (await add.isVisible()) await add.click();
  await page.getByTestId(`start-${id}`).click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
}

/** The left-eye object must be red-only light, the right-eye object cyan-only, where the module says. */
async function expectDrawnAt(
  page: Page,
  leftName: string,
  rightName: string,
  radius: { left: number; right: number },
) {
  const left = await probePoint(page, leftName);
  const right = await probePoint(page, rightName);
  const red = await channelCentroid(page, left, radius.left, 'red');
  const cyan = await channelCentroid(page, right, radius.right, 'cyan');
  expect(red, `${leftName}: red (left-eye) pixels near its position`).not.toBeNull();
  expect(cyan, `${rightName}: cyan (right-eye) pixels near its position`).not.toBeNull();
  expect(Math.hypot(red!.x - left.x, red!.y - left.y)).toBeLessThan(6);
  expect(Math.hypot(cyan!.x - right.x, cyan!.y - right.y)).toBeLessThan(6);
  // And the eyes do not leak into each other's channel at those spots.
  expect(await channelCentroid(page, left, 6, 'cyan')).toBeNull();
  expect(await channelCentroid(page, right, 6, 'red')).toBeNull();
}

test.describe('stimulus rendering', () => {
  test.beforeEach(async ({ page }) => {
    await acceptDisclaimer(page);
    await importBundle(page, bundle({ ...unlockedHistory(), balanceRatio: 0.6 }));
  });

  test('L1: bird in the left eye (red), cage in the right eye (cyan)', async ({ page }) => {
    await startModule(page, 'l1');
    await expectDrawnAt(page, 'bird', 'cage', { left: 26, right: 26 });
  });

  test('L2: the left-eye ball is drawn with the calibrated prism offset', async ({ page }) => {
    await startModule(page, 'l2');
    // At the start (before any input) the ball sits 60 px below the ring in layer space;
    // on screen the left eye's image is shifted by the calibrated 7Δ base-in offset.
    const ring = await probePoint(page, 'ring');
    const ball = await probePoint(page, 'ball');
    expect(ball.x - ring.x).toBeCloseTo(LEFT_EYE_OFFSET_PX, 0);
    expect(ball.y - ring.y).toBeCloseTo(60, 0);
    // The ring is hollow: search a box that covers the whole ring and its ticks.
    await expectDrawnAt(page, 'ball', 'ring', { left: 20, right: 70 });
  });

  test('L3: falling star in the left eye, basket in the right eye', async ({ page }) => {
    await startModule(page, 'l3');
    // Stars fall slowly (about 1 px per frame), so position and pixels are read close enough.
    const star = await probePoint(page, 'star');
    const red = await channelCentroid(page, star, 24, 'red');
    expect(red).not.toBeNull();
    expect(Math.hypot(red!.x - star.x, red!.y - star.y)).toBeLessThan(6);
    // The basket is a wide open tray: check it is centred horizontally on its position.
    const basket = await probePoint(page, 'basket');
    const cyan = await channelCentroid(page, basket, 90, 'cyan');
    expect(cyan).not.toBeNull();
    expect(Math.abs(cyan!.x - basket.x)).toBeLessThan(6);
  });
});

test('the app refuses to run inside another site’s frame', async ({ page }) => {
  // A page on another origin (about:blank here) embeds the app.
  await page.setContent(`<iframe src="${ORIGIN}/" width="800" height="600" title="embedded"></iframe>`);
  const frame = page.frameLocator('iframe');
  // Chromium blocks a cross-origin frame from navigating the top window without a user
  // gesture, so the app stays in the frame: it must show only the notice, never the UI.
  await expect(frame.locator('#frame-notice')).toBeVisible();
  await expect(frame.locator('#frame-notice a')).toHaveAttribute('target', '_blank');
  await expect(frame.locator('#root')).toBeEmpty();
  await expect(frame.locator('#root')).toBeHidden();
  // Top-level loads are unaffected.
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-frame-ok', '');
  await expect(page.locator('#frame-notice')).toHaveCount(0);
});

test('uncaught errors are kept in the local error log and can be exported or cleared', async ({ page }) => {
  await acceptDisclaimer(page);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e uncaught error');
    });
    void Promise.reject(new Error('e2e rejected promise'));
  });
  await page.goto('/#/settings');
  await expect(page.getByTestId('error-log-count')).toContainText('2 error(s) logged');
  await expect(page.getByTestId('error-log')).toContainText('e2e uncaught error');
  await expect(page.getByTestId('error-log')).toContainText('e2e rejected promise');

  // Exported only when the user ticks the box.
  const exportOnce = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export everything (JSON)' }).click();
    const file = await (await download).path();
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(file, 'utf8')) as { errorLogs?: Array<{ message: string }> };
  };
  expect((await exportOnce()).errorLogs).toBeUndefined();
  await page.getByTestId('export-include-errors').check();
  const withLog = await exportOnce();
  expect(withLog.errorLogs?.map((e) => e.message).sort()).toEqual([
    'Error: e2e rejected promise',
    'Error: e2e uncaught error',
  ]);

  await page.getByTestId('error-log-clear').click();
  await expect(page.getByTestId('error-log-count')).toContainText('0 error(s) logged');
});

test('Chinese strings load only when Chinese is chosen', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/')) chunks.push(r.url());
  });
  await acceptDisclaimer(page);
  expect(chunks.some((u) => u.includes('zh-Hans'))).toBe(false);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: '简体中文' }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(chunks.some((u) => u.includes('zh-Hans'))).toBe(true);
  // The choice persists across reloads, and the strings come back before the first render.
  await page.reload();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});

test('pages loaded on demand still work offline once the app is installed', async ({ page, context }) => {
  await acceptDisclaimer(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The service worker precaches every chunk, including pages not visited yet.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/#/report');
  await expect(page.getByRole('heading', { name: 'Summary for your clinician' })).toBeVisible();
  await page.goto('/#/calibration');
  await expect(page.getByRole('heading', { name: 'Calibration wizard' })).toBeVisible();
  await context.setOffline(false);
});
