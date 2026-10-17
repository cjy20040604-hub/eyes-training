import { expect, test } from '@playwright/test';
import { acceptDisclaimer, bundle, channelCentroid, importBundle, probe, unlockedHistory } from './helpers';

/**
 * 0.4 end to end: quick start, one-eye check points with their consistency report, and the
 * error notice with a one-click problem report.
 */

test.setTimeout(3 * 60_000);
test.use({ viewport: { width: 1000, height: 700 } });

test('quick start: three answers, first session, then the full calibration is offered', async ({ page }) => {
  await acceptDisclaimer(page);
  await page.getByTestId('start-quick').click();
  await page.getByRole('button', { name: 'Laptop' }).click();
  await page.getByRole('button', { name: 'Square A' }).click();
  await page.getByTestId('quick-save').click();
  // Straight into the first L1 session (after the one-time comfort card).
  await page.getByTestId('ack-ergonomics').click();
  await expect(page.getByTestId('symptom-submit')).toBeVisible();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('symptom-submit').click();
  await page.goto('/#/');
  await expect(page.getByTestId('quick-banner')).toContainText('quick setup');
  // Stages that need exact geometry wait for the full calibration; so does the self-check.
  await expect(page.getByTestId('later-l4')).toContainText('Needs the full calibration');
  await page.goto('/#/check');
  await expect(page.getByRole('heading', { name: 'Weekly self-check' })).toBeVisible();
  await expect(page.getByRole('main').getByText(/Needs the full calibration/)).toBeVisible();
});

test('one-eye check points: a diamond appears to one eye; seeing it is recorded and reported', async ({
  page,
}) => {
  await page.clock.install();
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ ...unlockedHistory(), balanceRatio: 0.6 }));
  await page.goto('/#/train/l2');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await expect(page.getByTestId('catch-button')).toBeVisible();
  await expect(page.getByTestId('training-help')).toContainText('press C');
  // Within 45 s of active training a diamond appears, in one eye only.
  let point: { x: number; y: number; eye: 'left' | 'right' } | undefined;
  for (let i = 0; i < 50 && !point; i++) {
    await page.clock.runFor(1000);
    point = (await probe(page))?.['catch'];
  }
  expect(point).toBeDefined();
  // It is drawn in that eye's colour channel only.
  const own = await channelCentroid(page, point!, 16, point!.eye === 'left' ? 'red' : 'cyan');
  expect(own).not.toBeNull();
  await page.keyboard.press('c');
  await page.clock.runFor(300);
  expect((await probe(page))?.['catch']).toBeUndefined();
  await page.keyboard.press('Escape');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('summary-catch')).toContainText(
    point!.eye === 'left' ? 'left eye: 1 of 1' : 'right eye: 1 of 1',
  );
  await page.goto('/#/report');
  await expect(page.getByTestId('report-consistency')).toContainText('1/1 (100%)');
});

test('an error shows a notice; the report preview contains no training data', async ({ page }) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ ...unlockedHistory() }));
  await page.goto('/#/');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e notice error');
    });
  });
  await expect(page.getByTestId('error-notice')).toBeVisible();
  await page.getByTestId('error-notice').getByTestId('report-problem-open').click();
  const preview = page.getByTestId('report-preview');
  await expect(preview).toContainText('e2e notice error');
  await expect(preview).not.toContainText('cal_e2e');
  const href = await page.getByTestId('report-github').getAttribute('href');
  expect(href).toContain('https://github.com/cjy20040604-hub/eyes-training/issues/new?');
  expect(new URL(href!).searchParams.get('body')).toContain('e2e notice error');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('report-problem')).toHaveCount(0);
});
