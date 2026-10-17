import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer, bundle, importBundle, unlockedHistory } from './helpers';

/**
 * Weekly recap with the browser's on-device model. Playwright's Chromium has no built-in
 * model, so a scripted stand-in is installed before the app loads: it answers from the facts
 * in the prompt, the way a well-behaved model should. The real model is measured on the
 * evaluation page (#/lab/insights) in desktop Chrome.
 */

async function installFakeModel(page: Page, mode: 'grounded' | 'invents') {
  await page.addInitScript((m) => {
    const w = window as unknown as Record<string, unknown>;
    w.__lmPrompts = [];
    w.LanguageModel = {
      availability: () => Promise.resolve('available'),
      create: () =>
        Promise.resolve({
          prompt: (input: string) => {
            (w.__lmPrompts as string[]).push(input);
            const json = /Facts \(JSON\):\n(.*)\n/.exec(input)?.[1];
            const f = json ? (JSON.parse(json) as { thisWeek: { sessions: number; minutes: number } }) : null;
            const sessions = m === 'invents' ? 99 : (f?.thisWeek.sessions ?? 0);
            return Promise.resolve(
              JSON.stringify({
                headline: `${sessions} sessions this week`,
                points: [`You trained for ${f?.thisWeek.minutes ?? 0} minutes in total.`],
                suggestion: 'Keep the same calm routine and take the breaks.',
              }),
            );
          },
          destroy: () => {},
        }),
    };
  }, mode);
}

test('the recap is rewritten on the device and only sends numbers to the model', async ({ page }) => {
  await installFakeModel(page, 'grounded');
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ ...unlockedHistory() }));
  await page.goto('/#/report');
  const card = page.getByTestId('insight-card');
  await expect(card.getByTestId('insight-source')).toContainText('Rule-based summary');
  await expect(card.getByTestId('insight-recap')).toContainText('6 sessions');

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await card.getByTestId('insight-generate').click();
  await expect(card.getByTestId('insight-source')).toContainText('Written by on-device AI');
  await expect(card.getByTestId('insight-recap')).toContainText('6 sessions this week');
  expect(requests.filter((u) => !u.startsWith('http://localhost'))).toEqual([]);

  const prompts = await page.evaluate(() => (window as unknown as { __lmPrompts: string[] }).__lmPrompts);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).not.toMatch(/cal_e2e|20\d\d-\d\d-\d\d|diplopia/);
});

test('a draft with an invented number is retried, then the rule-based recap stays', async ({ page }) => {
  await installFakeModel(page, 'invents');
  await acceptDisclaimer(page);
  await importBundle(page, bundle({ ...unlockedHistory() }));
  await page.goto('/#/report');
  await page.getByTestId('insight-generate').click();
  await expect(page.getByTestId('insight-fallback')).toContainText('number:99');
  await expect(page.getByTestId('insight-source')).toContainText('Rule-based summary');
  const prompts = await page.evaluate(() => (window as unknown as { __lmPrompts: string[] }).__lmPrompts);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('the number 99 is not in the facts');
});

test('the evaluation page runs every case and reports the rates', async ({ page }) => {
  await installFakeModel(page, 'grounded');
  await acceptDisclaimer(page);
  await page.goto('/#/lab/insights');
  await expect(page.getByTestId('lab-availability')).toHaveText('available');
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-summary')).toBeVisible();
  await expect(page.getByTestId('lab-pass-first')).toHaveText('16 (100%)');
  await expect(page.getByTestId('lab-fallback')).toHaveText('0 (0%)');
  await expect(page.getByTestId('lab-row-doubtful')).toContainText('attempts 1');
  // The scripted model never mentions mismatches: the content checks catch that.
  await expect(page.getByTestId('lab-row-doubtful')).toContainText('mentions-mismatch');
});
