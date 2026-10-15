import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 end-to-end: unlocked stages appear under "Ready to add", each new module runs
 * through the real UI (pre-check, stimulus, input, STOP, post-check), the video module
 * plays a locally generated file, and the clinician report renders with charts.
 */

test.setTimeout(4 * 60_000);
test.use({ viewport: { width: 1100, height: 720 } });

function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bundle() {
  const sessions = [];
  const checks = [];
  for (const [i, off] of [-3, -3, -2, -2, -1, -1].entries()) {
    const day = dayKey(off);
    const id = `s${i}`;
    const moduleId = i % 2 === 0 ? 'l1' : 'l2';
    sessions.push({
      id,
      moduleId,
      calibrationId: 'cal_e2e',
      rendererId: 'anaglyph-canvas2d',
      startedAt: `${day}T0${i}:00:00.000Z`,
      endedAt: `${day}T0${i}:04:00.000Z`,
      day,
      plannedMinutes: 4,
      actualMinutes: 4,
      intensityTier: 'low',
      intensityValue: moduleId === 'l1' ? 0.6 : 0,
      intensityMetric: moduleId === 'l1' ? 'dominantContrastRatio' : 'offsetRemovedPercent',
      gameDifficulty: 1,
      viewingDistanceCm: 60,
      postureNote: '',
      status: 'completed',
      preCheckId: null,
      postCheckId: `c${i}`,
      events: [],
      metrics:
        moduleId === 'l2' ? { alignments: 8, meanResidualDelta: 1.2 + i * 0.1 } : { timeInCageFraction: 0.7 },
      notes: '',
    });
    checks.push({
      id: `c${i}`,
      sessionId: id,
      phase: 'post',
      at: `${day}T0${i}:05:00.000Z`,
      diplopia: 0,
      headache: 0,
      nausea: 0,
      eyestrain: i === 3 ? 1 : 0,
      confusion: 0,
      notes: '',
    });
  }
  return {
    app: 'eyes-training',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      activeCalibrationId: 'cal_e2e',
      ergonomicsAcknowledgedAt: '2026-09-01T10:00:00.000Z',
      clinicianAgreement: true,
    },
    calibrations: [
      {
        id: 'cal_e2e',
        name: 'E2E profile',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
        device: { ppi: 96, cardWidthPx: 323.5, dpr: 1, screenWidth: 1280, screenHeight: 720 },
        viewingDistanceCm: 60,
        channels: {
          left: { channel: 'red', gain: 1, gamma: 1 },
          right: { channel: 'cyan', gain: 1, gamma: 1 },
        },
        backgroundGray: 0,
        monocular: { leftVisible: true, rightVisible: true },
        worthFourDot: { result: 'left-suppression', dotsSeen: 3, notes: '' },
        clinicalPrism: {
          amountDelta: 7,
          base: 'in',
          range: 'distance',
          measuredOn: '2026-08-01',
          fusionWithPrism: 'fused',
          notes: '',
        },
        offset: {
          left: { dx: -158.7, dy: 0, rotationDeg: 0 },
          right: { dx: 0, dy: 0, rotationDeg: 0 },
          seededFromClinical: true,
          splitMode: 'left',
        },
        contrastBalance: { dominantEye: 'right', balanceRatio: 0.6, trials: 6 },
        postureNote: '',
      },
    ],
    sessions,
    symptomChecks: checks,
    safetyEvents: [],
  };
}

async function setup(page: Page) {
  await page.goto('/');
  for (const id of ['ack-1', 'ack-2', 'ack-3', 'ack-4']) await page.getByTestId(id).check();
  await page.getByTestId('accept-disclaimer').click();
  await page.goto('/#/settings');
  await page.getByLabel('Import JSON (merge)').setInputFiles({
    name: 'b.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle())),
  });
  await expect(page.getByText(/Imported/)).toBeVisible();
  await page.goto('/#/');
}

async function startFromOverview(page: Page, id: string) {
  await page.goto('/#/');
  const add = page.getByTestId(`add-${id}`);
  if (await add.isVisible()) await add.click();
  await page.getByTestId(`start-${id}`).click();
}

async function stopAndFinish(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overlay-stop')).toBeVisible();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('summary-minutes')).toBeVisible();
}

test('unlocked stages appear under "Ready to add"; a STOP re-locks advanced stages', async ({ page }) => {
  await setup(page);
  // All later stages are unlocked (6 comfortable sessions on 3 days, clinician agreement on).
  for (const id of ['l3', 'l4', 'l5', 'video'])
    await expect(page.getByTestId(`available-${id}`)).toBeVisible();
  await expect(page.getByText('All stages are unlocked.')).toBeVisible();
  await page.getByTestId('add-l3').click();
  await expect(page.getByTestId('start-l3')).toBeVisible();
  await expect(page.getByTestId('available-l3')).toHaveCount(0);

  // ---- L3: catch stars with the basket ----
  await page.getByTestId('start-l3').click();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-help')).toContainText('basket');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowLeft');
  await expect(page.getByTestId('hud-prompt')).toContainText(/star|Streak|cloud/i);
  await stopAndFinish(page);
  await expect(page.getByText('Stars caught')).toBeVisible();

  // Safety rule: a STOP in the last 3 sessions locks the advanced stages again.
  await page.goto('/#/');
  await expect(page.getByTestId('later-l4')).toContainText('STOP');
});

test('L4 records vergence break and recovery', async ({ page }) => {
  await setup(page);
  await startFromOverview(page, 'l4');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('hud-prompt')).toContainText('Press Space when you see two', {
    timeout: 10_000,
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-prompt')).toContainText('single again');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-prompt')).toContainText('Rest');
  await stopAndFinish(page);
  await expect(page.getByText('Mean break, base-out')).toBeVisible();
});

test('L5 runs the random-dot stereo staircase', async ({ page }) => {
  await setup(page);
  await startFromOverview(page, 'l5');
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('hud-prompt')).toContainText('floating square', { timeout: 10_000 });
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('hud-prompt')).toContainText(/that was it|Not this time/);
  await expect(page.getByTestId('hud-prompt')).toContainText('floating square', { timeout: 10_000 });
  await page.keyboard.press('Space'); // "cannot tell"
  await stopAndFinish(page);
  await expect(page.getByText('Patterns shown')).toBeVisible();
});

test('the video module plays a local file and refuses to start without one', async ({ page }) => {
  await setup(page);
  await startFromOverview(page, 'video');
  await expect(page.getByTestId('video-setup')).toBeVisible();

  // No file chosen yet: the session does not start.
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByText('Choose what to watch first')).toBeVisible();

  // Make a short WebM in the page (canvas + MediaRecorder) and choose it as the file.
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.start();
    for (let i = 0; i < 45; i++) {
      g.fillStyle = '#333';
      g.fillRect(0, 0, 320, 180);
      g.fillStyle = '#ccc';
      g.fillRect(20 + i * 4, 60, 60, 60);
      await new Promise((r) => setTimeout(r, 33));
    }
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await page.getByTestId('video-file').setInputFiles({
    name: 'calm-clip.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(b64, 'base64'),
  });
  await expect(page.getByText('Chosen: calm-clip.webm')).toBeVisible();
  await page.getByTestId('symptom-submit').click();
  await expect(page.getByTestId('training-canvas')).toBeVisible();
  await expect(page.getByTestId('hud-prompt')).toContainText(/Watching calm-clip.webm|Press Space or tap/, {
    timeout: 10_000,
  });
  await stopAndFinish(page);
  await expect(page.getByText('Seconds watched')).toBeVisible();
});

test('the clinician report summarizes adherence, measures and trends', async ({ page }) => {
  await setup(page);
  await page.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Summary for your clinician' })).toBeVisible();
  await expect(page.getByTestId('report-adherence')).toContainText('3 of 30 days');
  await expect(page.getByTestId('report-adherence')).toContainText('6 (6 completed, 0 stopped)');
  await expect(page.getByTestId('report-measures')).toContainText('perceived offset');
  await expect(page.getByText('7Δ Base-in')).toBeVisible();
  await expect(page.getByTestId('chart-minutes').locator('svg')).toBeVisible();
  await expect(page.getByTestId('chart-offset').locator('circle')).toHaveCount(3);
  await expect(page.getByTestId('report-print')).toBeVisible();
  // History shows the same trends.
  await page.goto('/#/history');
  await expect(page.getByTestId('trends')).toBeVisible();
});
