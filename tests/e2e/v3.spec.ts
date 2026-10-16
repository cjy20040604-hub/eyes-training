import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  LEFT_EYE_OFFSET_PX,
  acceptDisclaimer,
  bundle,
  channelCentroid,
  importBundle,
  probePoint,
  unlockedHistory,
} from './helpers';

/**
 * 0.3 end to end: the weekly check, data safety (encrypted backup, reminders, backup
 * banner), calendar reminders, the Brock string, dichoptic reading, built-in video scenes,
 * and the VR fallback when no headset is present.
 */

test.setTimeout(3 * 60_000);
test.use({ viewport: { width: 1100, height: 760 } });

async function unlocked(page: Page, settings: Record<string, unknown> = {}) {
  await acceptDisclaimer(page);
  await importBundle(
    page,
    bundle({ ...unlockedHistory(), settings: { clinicianAgreement: true, ...settings }, balanceRatio: 0.6 }),
  );
}

async function startModule(page: Page, id: string) {
  await page.goto('/#/');
  const add = page.getByTestId(`add-${id}`);
  if (await add.isVisible()) await add.click();
  await page.getByTestId(`start-${id}`).click();
}

async function download(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const d = page.waitForEvent('download');
  await click();
  const file = await d;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

test('weekly check: four measurements, results, and the report', async ({ page }) => {
  await unlocked(page);
  await page.goto('/#/');
  await expect(page.getByTestId('weekly-check-card')).toContainText('first two checks set your baseline');
  await page.getByTestId('start-weekly-check').click();
  await page.getByTestId('symptom-submit').click();

  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.getByTestId('check-next').click();
  // Alignment: arrow keys move the left image; confirm twice.
  await expect(page.getByTestId('check-align-canvas')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.getByTestId('align-done').click();
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('align-done').click();
  await page.getByTestId('balance-equal').click();
  await page.getByTestId('balance-equal').click();
  // Stereo: real random-dot patterns; answer "can't tell" until it stops by itself.
  await expect(page.getByTestId('check-stereo-canvas')).toBeVisible();
  const post = page.getByTestId('symptom-check-post');
  for (let i = 0; i < 35 && !(await post.isVisible()); i++) {
    // The click waits until the next pattern is shown (0.5 s between patterns).
    await page
      .getByTestId('stereo-cant')
      .click({ timeout: 3000 })
      .catch(() => {});
  }
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('check-result')).toContainText('Perceived misalignment');

  await page.goto('/#/');
  await expect(page.getByTestId('weekly-check-card')).toContainText('Next check in 7 day(s)');
  await page.goto('/#/report');
  await expect(page.getByTestId('report-checks')).toContainText('Stereo threshold');
  await expect(page.getByTestId('chart-check-alignment').locator('circle')).toHaveCount(1);
  await page.goto('/#/history');
  await expect(page.getByTestId('check-trends')).toBeVisible();
});

test('Brock string: each eye sees its own string; crossings and fading are recorded', async ({ page }) => {
  await unlocked(page);
  await startModule(page, 'brock');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('hud-prompt')).toContainText('NEAR bead');
  // The ringed near bead has crossed disparity: relative to the calibrated prism offset, the
  // left eye's (red) bead sits to the right of the right eye's (cyan) one.
  const left = await probePoint(page, 'targetLeft');
  const right = await probePoint(page, 'targetRight');
  expect(left.x - right.x - LEFT_EYE_OFFSET_PX).toBeGreaterThan(30);
  expect(await channelCentroid(page, left, 16, 'red')).not.toBeNull();
  expect(await channelCentroid(page, right, 16, 'cyan')).not.toBeNull();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-prompt')).toContainText('crossing seen');
  await expect(page.getByTestId('hud-prompt')).toContainText('MIDDLE bead', { timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('hud-prompt')).toContainText('One string faded');
  await page.keyboard.press('Escape');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByText('Crossings seen')).toBeVisible();
});

test('two-eye reading: pages turn and "words missing" is recorded', async ({ page }) => {
  await unlocked(page);
  await startModule(page, 'reading');
  await page.getByTestId('symptom-submit').click();
  // A passage may fit on one page on a large screen; then Space starts the next passage.
  await expect(page.getByTestId('hud-prompt')).toContainText(/Page 1 of \d|Last page/);
  // Words alternate between the eyes: the text area has both red-only and cyan-only text.
  const box = await page.getByTestId('training-canvas').boundingBox();
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(await channelCentroid(page, centre, 300, 'red')).not.toBeNull();
  expect(await channelCentroid(page, centre, 300, 'cyan')).not.toBeNull();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-score')).toContainText('1');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('hud-prompt')).toContainText('Words missing');
  await page.keyboard.press('Escape');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByText('Pages read')).toBeVisible();
});

test('video: a built-in calm scene plays without any file', async ({ page }) => {
  await unlocked(page);
  await startModule(page, 'video');
  await expect(page.getByTestId('video-setup')).toBeVisible();
  await page.getByRole('button', { name: 'Drifting clouds' }).click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('hud-prompt')).toContainText('Drifting clouds', { timeout: 10_000 });
  // The scene is drawn: the canvas is not black.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('[data-testid=training-canvas]')!;
        const d = c.getContext('2d')!.getImageData(c.width / 2 - 50, c.height / 2 - 50, 100, 100).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 60) lit++;
        return lit;
      }),
    )
    .toBeGreaterThan(500);
  await page.keyboard.press('Escape');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByText('Seconds watched')).toBeVisible();
});

test('encrypted backup: export, wipe, and restore with the passphrase', async ({ page }) => {
  await unlocked(page);
  await page.goto('/#/settings');
  await page.getByLabel('Passphrase (at least 8 characters)').fill('green-lantern-42');
  await page.getByLabel('Repeat the passphrase').fill('green-lantern-42');
  const backup = await download(page, () => page.getByTestId('export-encrypted').click());
  expect(backup.name).toMatch(/\.bvx$/);
  expect(backup.text).toContain('eyes-training-encrypted');
  expect(backup.text).not.toContain('cal_e2e');
  await expect(page.getByTestId('backup-last')).not.toHaveText('Never');

  // Wipe everything.
  await page.getByRole('button', { name: 'Delete all local data' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // Deleting is asynchronous; once it is done the app asks for the disclaimer again.
  await expect(page.getByTestId('accept-disclaimer')).toBeVisible();
  for (const id of ['ack-1', 'ack-2', 'ack-3', 'ack-4']) await page.getByTestId(id).check();
  await page.getByTestId('accept-disclaimer').click();
  await page.goto('/#/history');
  await expect(page.locator('tbody tr', { hasText: 'Completed' })).toHaveCount(0);

  // Restore.
  await page.goto('/#/settings');
  await page.getByLabel('Import JSON (merge)').setInputFiles({
    name: backup.name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(backup.text),
  });
  await page.getByLabel('Passphrase of the backup').fill('wrong one!!');
  await page.getByTestId('import-decrypt').click();
  await expect(page.getByText(/Wrong passphrase/)).toBeVisible();
  await page.getByLabel('Passphrase of the backup').fill('green-lantern-42');
  await page.getByTestId('import-decrypt').click();
  await expect(page.getByText(/Imported/)).toBeVisible();
  await page.goto('/#/history');
  await expect(page.locator('tbody tr', { hasText: 'Completed' })).toHaveCount(6);
});

test('backup reminder, weekly goal and calendar reminder', async ({ page }) => {
  await unlocked(page);
  await page.goto('/#/');
  await expect(page.getByTestId('weekly-goal')).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toContainText('no backup yet');
  const json = await download(page, () => page.getByTestId('backup-now').click());
  expect(JSON.parse(json.text).app).toBe('eyes-training');
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);

  await page.getByRole('link', { name: 'Goal and reminders' }).click();
  await page.getByLabel('Time').fill('07:45');
  const ics = await download(page, () => page.getByTestId('download-ics').click());
  expect(ics.name).toBe('eyes-training-reminder.ics');
  expect(ics.text).toContain('BEGIN:VEVENT');
  expect(ics.text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR,SA');
  expect(ics.text).toMatch(/DTSTART:\d{8}T074500/);
});

test('without a VR headset, VR stays off and sessions use the glasses', async ({ page }) => {
  await unlocked(page, { rendererId: 'webxr' });
  await page.goto('/#/settings');
  await expect(page.getByTestId('vr-support')).toContainText('No VR headset found');
  await page.goto('/#/train/l1');
  await expect(page.getByTestId('vr-fallback')).toContainText('no headset is available');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await expect(page.getByTestId('vr-enter')).toHaveCount(0);
});
