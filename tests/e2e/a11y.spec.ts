import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer, bundle, importBundle, unlockedHistory } from './helpers';

/**
 * Accessibility: an automated WCAG 2.1 A/AA scan (axe-core) of every page of the app shell,
 * plus keyboard checks. The training picture itself is a visual stimulus by nature (a canvas
 * with a text alternative); everything around it must work with a keyboard and a screen
 * reader.
 */

test.use({ viewport: { width: 1100, height: 800 } });

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${name}: ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

test('first run: the disclaimer page passes the WCAG scan', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('accept-disclaimer')).toBeVisible();
  await scan(page, 'disclaimer');
});

test('every page passes the WCAG scan', async ({ page }) => {
  await acceptDisclaimer(page);
  await scan(page, 'overview (empty)');
  await page.goto('/#/quick-start');
  await expect(page.getByTestId('quick-start')).toBeVisible();
  await scan(page, 'quick start');
  await page.goto('/#/calibration');
  await expect(page.getByRole('heading', { name: 'Calibration wizard' })).toBeVisible();
  await scan(page, 'calibration');

  await importBundle(page, bundle({ ...unlockedHistory(), settings: { clinicianAgreement: true } }));
  for (const [hash, name] of [
    ['#/', 'overview'],
    ['#/history', 'history'],
    ['#/report', 'report'],
    ['#/settings', 'settings'],
    ['#/module/l2', 'module page'],
    ['#/account', 'account'],
  ] as const) {
    await page.goto(`/${hash}`);
    await expect(page.locator('main h1').first()).toBeVisible();
    await scan(page, name);
  }
  // Training: the pre-session check and the running screen.
  await page.goto('/#/train/l2');
  await expect(page.getByTestId('symptom-submit')).toBeVisible();
  await scan(page, 'pre-session check');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await scan(page, 'training screen');
  // Weekly self-check intro.
  await page.goto('/#/check');
  await expect(page.getByTestId('symptom-submit')).toBeVisible();
  await scan(page, 'weekly self-check');
});

test('keyboard: skip to content, visible focus, STOP by Escape, dialogs close with Escape', async ({
  page,
}) => {
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ ...unlockedHistory() }));
  await page.goto('/#/');
  await page.reload(); // a fresh page, as on a first visit
  // The first Tab lands on the skip link, which moves focus to the main content.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  // Focus is visible on interactive elements.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return 'none';
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  expect(outline).not.toMatch(/^none/);

  // Training: Escape is STOP.
  await page.goto('/#/train/l1');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overlay-stop')).toBeVisible();

  // The problem-report dialog is modal and closes with Escape.
  await page.goto('/#/settings');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('a11y test error');
    });
  });
  await page.getByTestId('report-problem-open').first().click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('What were you doing? (optional)')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
