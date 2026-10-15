import { expect, test, type Page } from '@playwright/test';

/**
 * Plays the real app over three simulated days, black-box:
 *  - runs the calibration wizard through the UI (including arrow-key nudging);
 *  - each day plays L1 "Both Eyes On" and L2 "Line Them Up" to completion by locating the
 *    cage / ring on the rendered canvas and clicking it, pressing Space for chicks;
 *  - checks scores rise, sessions complete, difficulty progresses day to day, and the
 *    L3-L5 gate opens after 6 clean sessions on 3 days.
 * Time is driven by Playwright's fake clock, so a 2-minute session runs in seconds.
 */

test.setTimeout(10 * 60_000);
// A smaller window keeps per-frame canvas work (and so the test) fast.
test.use({ viewport: { width: 820, height: 560 } });

const DAY = (n: number) => new Date(`2026-10-0${4 + n}T09:00:00`);

async function acceptDisclaimer(page: Page) {
  await page.goto('/');
  for (const id of ['ack-1', 'ack-2', 'ack-3', 'ack-4']) await page.getByTestId(id).check();
  await page.getByTestId('accept-disclaimer').click();
  await expect(page.getByRole('heading', { name: "Today's training" })).toBeVisible();
}

async function runWizard(page: Page) {
  await page.goto('/#/calibration');
  const next = page.getByTestId('wizard-next');
  await next.click(); // safety
  await expect(page.getByTestId('ppi-value')).toContainText('pixels per inch');
  await next.click(); // screen (defaults are plausible)
  await page.getByRole('button', { name: 'Square A', exact: true }).click();
  await next.click(); // glasses
  await page.getByRole('button', { name: 'Yes', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).nth(1).click();
  await next.click(); // monocular
  await page.getByRole('button', { name: '3', exact: true }).click();
  await next.click(); // worth 4-dot
  await page.getByTestId('seed-offset').click();
  const readout = page.getByTestId('offset-readout');
  const dx = async () => Number(/dx (-?[\d.]+) px/.exec((await readout.textContent()) ?? '')?.[1]);
  // 7Δ base-in at 60 cm and ~96 PPI seeds about -159 px on the left eye.
  await expect(readout).toContainText('≈ 7Δ');
  const seeded = await dx();
  expect(seeded).toBeLessThan(-150);
  // Arrow keys nudge the left-eye image on this step (default nudge 5 px).
  await page.keyboard.press('ArrowRight');
  await expect.poll(dx).toBeCloseTo(seeded + 5, 0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(dx).toBeCloseTo(seeded, 0);
  await next.click(); // offset
  await page.getByRole('button', { name: 'They look equal' }).click();
  await page.getByRole('button', { name: 'They look equal' }).click();
  await next.click(); // contrast
  await page.getByTestId('wizard-save').click();
  await expect(page.getByRole('heading', { name: "Today's training" })).toBeVisible();
}

async function setShortSessions(page: Page) {
  await page.goto('/#/settings');
  await page.locator('#session-max').fill('2');
  await page.goto('/#/');
}

/** Centroid (CSS px, page coordinates) of the brightest cyan-only pixels: the right-eye target. */
async function locateTarget(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=training-canvas]');
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const { width, height } = c;
    const d = ctx.getImageData(0, 0, width, height).data;
    let maxG = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 40 && d[i + 1]! > maxG) maxG = d[i + 1]!;
    if (maxG < 60) return null;
    const thr = maxG * 0.8; // the shared frame is drawn at half intensity, so it is excluded
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const i = (y * width + x) * 4;
        if (d[i]! < 40 && d[i + 1]! >= thr && d[i + 2]! >= thr) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    if (n === 0) return null;
    const r = c.getBoundingClientRect();
    const sxCss = r.width / width;
    const syCss = r.height / height;
    return { x: r.left + (sx / n) * sxCss, y: r.top + (sy / n) * syCss };
  });
}

async function score(page: Page): Promise<number> {
  const text = (await page.getByTestId('hud-score').textContent()) ?? '';
  return Number(text.replace(/\D+/g, '')) || 0;
}

async function startSession(page: Page, moduleId: 'l1' | 'l2') {
  await page.goto('/#/');
  await page.getByTestId(`start-${moduleId}`).click();
  const ergo = page.getByTestId('ack-ergonomics');
  const submit = page.getByTestId('symptom-submit');
  await expect(ergo.or(submit)).toBeVisible();
  if (await ergo.isVisible()) await ergo.click();
  await submit.click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await expect(page.getByTestId('training-help')).toContainText('click / tap');
}

/**
 * Play until the post-session check appears, calling `step(t, active)` between time advances.
 * The first `activeMs` run every animation frame (runFor). After that, time jumps forward in
 * 250 ms steps (fastForward: one frame and one timer tick per step), which keeps the session
 * logic real while skipping most of the per-frame drawing cost.
 */
async function playUntilEnd(
  page: Page,
  step: (t: number, active: boolean) => Promise<void>,
  activeMs = 30_000,
  maxMs = 3 * 60_000,
) {
  const post = page.getByTestId('symptom-check-post');
  let t = 0;
  while (t < maxMs) {
    if (await post.isVisible()) return;
    const active = t < activeMs;
    await step(t, active);
    if (active) {
      await page.clock.runFor(1000);
      t += 1000;
    } else {
      await page.clock.fastForward(250);
      t += 250;
    }
  }
  await expect(post).toBeVisible();
}

async function finishWithCleanCheck(page: Page): Promise<string> {
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('summary-minutes')).toBeVisible();
  return (await page.locator('main').textContent()) ?? '';
}

async function playL1(page: Page) {
  await startSession(page, 'l1');
  let chicks = 0;
  await playUntilEnd(page, async (t, active) => {
    if (active || t % 1000 === 0) {
      const cage = await locateTarget(page);
      if (cage) await page.mouse.click(cage.x, cage.y);
    }
    const prompt = (await page.getByTestId('hud-prompt').textContent()) ?? '';
    if (prompt.includes('chick')) {
      await page.keyboard.press('Space');
      chicks++;
    }
  });
  expect(chicks).toBeGreaterThan(0);
  return finishWithCleanCheck(page);
}

async function playL2(page: Page) {
  await startSession(page, 'l2');
  // Bug regression: a single click on the ring must move the ball and score.
  // The first frames may not be drawn yet on a slow machine, so let time run until the ring shows.
  let ring = await locateTarget(page);
  for (let i = 0; !ring && i < 20; i++) {
    await page.clock.runFor(100);
    ring = await locateTarget(page);
  }
  expect(ring).not.toBeNull();
  await page.mouse.click(ring!.x, ring!.y);
  await page.clock.runFor(2500);
  // At least one round scored (the ring may land near the ball again by chance).
  expect(await score(page)).toBeGreaterThanOrEqual(10);

  // Bug regression: holding an arrow key moves the ball continuously.
  await page.keyboard.down('ArrowLeft');
  await page.clock.runFor(1000);
  await page.keyboard.up('ArrowLeft');

  await playUntilEnd(page, async (t, active) => {
    if (!active && t % 1000 !== 0) return;
    const prompt = (await page.getByTestId('hud-prompt').textContent()) ?? '';
    // Leave the ball alone while the ring glides or while the hold arc is filling.
    if (prompt.includes('ring is moving') || prompt.includes('Hold it')) return;
    const target = await locateTarget(page);
    if (target) await page.mouse.click(target.x, target.y);
  });
  return finishWithCleanCheck(page);
}

async function gameDifficultyOnOverview(page: Page, code: 'L1' | 'L2'): Promise<string> {
  await page.goto('/#/');
  return (await page.getByTestId(`game-level-${code.toLowerCase()}`).textContent()) ?? '';
}

test('three days of L1 + L2 training: play, complete, progress, unlock gate', async ({ page }) => {
  await page.clock.install({ time: DAY(1) });
  await acceptDisclaimer(page);
  await runWizard(page);
  await setShortSessions(page);

  // ---- Day 1 ----
  const l1Day1 = await playL1(page);
  expect(l1Day1).toContain('Game difficulty for the next session: 2/5');
  const l2Day1 = await playL2(page);
  expect(l2Day1).toContain('Game difficulty for the next session: 2/5');
  await page.goto('/#/');
  const l3Card = page.getByTestId('later-l3');
  await expect(l3Card).toContainText('2 of 6 comfortable sessions, 1 of 3 days');

  // ---- Day 2: the previous problem day ----
  await page.clock.setSystemTime(DAY(2));
  expect(await gameDifficultyOnOverview(page, 'L1')).toContain('Game level 2 of 5');
  expect(await gameDifficultyOnOverview(page, 'L2')).toContain('Game level 2 of 5');
  expect(await playL1(page)).toContain('Game difficulty for the next session: 3/5');
  expect(await playL2(page)).toContain('Game difficulty for the next session: 3/5');

  // ---- Day 3 ----
  await page.clock.setSystemTime(DAY(3));
  // L1 is at game level 3, so it would step visual difficulty next. The wizard's balance point
  // here is 100% right-eye contrast, which is already the maximum, so game difficulty rises.
  expect(await playL1(page)).toContain('Game difficulty for the next session: 4/5');
  // L2 visual difficulty needs clinician agreement, so game difficulty rises.
  expect(await playL2(page)).toContain('Game difficulty for the next session: 4/5');

  // 6 clean sessions on 3 days: the L3 gate no longer asks for more sessions.
  await page.goto('/#/');
  // L3 is now unlocked and offered under "Ready to add".
  await expect(page.getByTestId('available-l3')).toBeVisible();
  await expect(page.getByTestId('later-l3')).toHaveCount(0);
  // L4 (vergence) additionally still needs clinician agreement.
  await expect(page.getByTestId('later-l4')).toContainText('clinician agreement');

  // History shows all six completed sessions.
  await page.goto('/#/history');
  await expect(page.locator('tbody tr', { hasText: 'Completed' })).toHaveCount(6);
});
