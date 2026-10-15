import { expect, test } from '@playwright/test';
import { ORIGIN, acceptDisclaimer, bundle, dayKey, importBundle } from './helpers';

test('first run enforces the disclaimer and makes no non-local network requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith(ORIGIN)) external.push(req.url());
  });
  await acceptDisclaimer(page);
  await page.goto('/#/calibration');
  await expect(page.getByRole('heading', { name: 'Calibration wizard' })).toBeVisible();
  await page.goto('/#/history');
  await page.goto('/#/settings');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('STOP button is present during training, halts on Escape, records the event', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle());
  await page.goto('/#/');
  await page.getByTestId('start-l1').click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  const stop = page.getByTestId('stop-button');
  await expect(stop).toBeVisible();
  const styles = await stop.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor, clip: s.clipPath };
  });
  expect(styles.color).toBe('rgb(0, 0, 0)');
  expect(styles.bg).toBe('rgb(255, 255, 255)');
  expect(styles.clip).toContain('polygon');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overlay-stop')).toBeVisible();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('summary-minutes')).toBeVisible();
  await page.goto('/#/history');
  await expect(page.getByText('user pressed STOP')).toBeVisible();
});

test('a red-flag report disables training until acknowledged', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle());
  await page.goto('/#/');
  await page.getByTestId('start-l2').click();
  await page.getByTestId('redflag-ptosis').check();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByText('Stop and seek urgent medical attention')).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByText('Training is disabled after a red-flag report.')).toBeVisible();
  await expect(page.getByTestId('start-l1')).toHaveCount(0);
  await page.goto('/#/train/l1');
  await expect(page.getByTestId('block-training-locked')).toBeVisible();
});

test('the global daily cap blocks further training across modules', async ({ page }) => {
  await acceptDisclaimer(page);
  const day = dayKey();
  const sessions = ['l1', 'l2', 'l1'].map((moduleId, i) => ({
    id: `ses_cap_${i}`,
    moduleId,
    calibrationId: 'cal_e2e',
    rendererId: 'anaglyph-canvas2d',
    startedAt: `${day}T08:0${i}:00.000Z`,
    endedAt: `${day}T08:1${i}:00.000Z`,
    day,
    plannedMinutes: 10,
    actualMinutes: 10,
    intensityTier: 'low',
    intensityValue: 0.5,
    intensityMetric: 'dominantContrastRatio',
    gameDifficulty: 1,
    viewingDistanceCm: 60,
    postureNote: '',
    status: 'completed',
    preCheckId: null,
    postCheckId: null,
    events: [],
    metrics: {},
    notes: '',
  }));
  await importBundle(page, bundle({ sessions }));
  await page.goto('/#/');
  await expect(page.getByText('Daily cap reached')).toBeVisible();
  await expect(page.getByTestId('start-l1')).toHaveCount(0);
  await expect(page.getByTestId('start-l2')).toHaveCount(0);
  await page.goto('/#/train/l2');
  await expect(page.getByTestId('block-cap')).toBeVisible();
});

test('renderer can be swapped without changing modules', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ settings: { rendererId: 'sbs' } }));
  await page.goto('/#/');
  await page.getByTestId('start-l1').click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overlay-stop')).toBeVisible();
});

test('switching training pages mid-session starts fresh and closes the old session', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle());
  await page.goto('/#/');
  await page.getByTestId('start-l2').click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  // Jump straight to L1 (as the browser's back/forward buttons can do).
  await page.goto('/#/train/l1');
  await expect(page.getByTestId('symptom-check-pre')).toBeVisible();
  await page.goto('/#/history');
  await expect(page.locator('tbody tr', { hasText: 'Aborted' })).toHaveCount(1);
  await expect(page.locator('tbody tr', { hasText: 'In progress' })).toHaveCount(0);
});

test('pausing when the window is hidden stops the session timer until resumed', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle());
  await page.goto('/#/');
  await page.getByTestId('start-l1').click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('overlay-paused')).toBeVisible();
  const before = await page.getByTestId('hud-timer').textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId('hud-timer').textContent()).toBe(before);
  await page.getByTestId('resume-button').click();
  await expect(page.getByTestId('overlay-paused')).toHaveCount(0);
  await expect(page.getByTestId('hud-timer')).not.toHaveText(before ?? '', { timeout: 5000 });
});
