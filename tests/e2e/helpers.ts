import { expect, type Page } from '@playwright/test';

/** Shared setup for the end-to-end specs. */

export const ORIGIN = 'http://localhost:4173';

/** Local calendar day key, offset by whole days from today. */
export function dayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A calibration for a 96 PPI screen at 60 cm with the 7Δ base-in offset on the left eye. */
export function calibration(overrides: { balanceRatio?: number } = {}) {
  return {
    id: 'cal_e2e',
    name: 'E2E profile',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    device: { ppi: 96, cardWidthPx: 323.5, dpr: 1, screenWidth: 1280, screenHeight: 720 },
    viewingDistanceCm: 60,
    channels: { left: { channel: 'red', gain: 1, gamma: 1 }, right: { channel: 'cyan', gain: 1, gamma: 1 } },
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
    contrastBalance: { dominantEye: 'right', balanceRatio: overrides.balanceRatio ?? 0.5, trials: 6 },
    postureNote: '',
  };
}

export const LEFT_EYE_OFFSET_PX = -158.7;

export function bundle(
  extra: {
    sessions?: unknown[];
    symptomChecks?: unknown[];
    settings?: Record<string, unknown>;
    balanceRatio?: number;
  } = {},
) {
  return {
    app: 'eyes-training',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      activeCalibrationId: 'cal_e2e',
      ergonomicsAcknowledgedAt: '2026-09-01T10:00:00.000Z',
      ...(extra.settings ?? {}),
    },
    calibrations: [calibration({ balanceRatio: extra.balanceRatio })],
    sessions: extra.sessions ?? [],
    symptomChecks: extra.symptomChecks ?? [],
    safetyEvents: [],
  };
}

/**
 * Six comfortable L1/L2 sessions (with post-session checks) over the last three days: enough
 * to unlock L3–L5 and video (L4 also needs clinician agreement in settings).
 */
export function unlockedHistory(): { sessions: unknown[]; symptomChecks: unknown[] } {
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
  return { sessions, symptomChecks: checks };
}

export async function acceptDisclaimer(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('accept-disclaimer')).toBeDisabled();
  for (const id of ['ack-1', 'ack-2', 'ack-3', 'ack-4']) await page.getByTestId(id).check();
  await page.getByTestId('accept-disclaimer').click();
  await expect(page.getByRole('heading', { name: "Today's training" })).toBeVisible();
}

export async function importBundle(page: Page, data: unknown) {
  await page.goto('/#/settings');
  await page.getByLabel('Import JSON (merge)').setInputFiles({
    name: 'bundle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText(/Imported/)).toBeVisible();
}

export type Probe = Record<string, { x: number; y: number; eye: 'left' | 'right' }>;

/**
 * Page coordinates of the running module's key objects, from the test hook that only
 * e2e builds include (see TrainingCanvas.tsx). Null until a training canvas is mounted.
 */
export async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const w = window as Window & { __bvProbe?: () => Probe };
    return w.__bvProbe ? w.__bvProbe() : null;
  });
}

/** Wait until the module reports an object with this name. Works with a real or fake clock. */
export async function probePoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | undefined;
  await expect
    .poll(async () => {
      point = (await probe(page))?.[name];
      return point !== undefined;
    })
    .toBe(true);
  return point!;
}

/**
 * Centroid (page px) of the brightest single-channel pixels within `radius` of (x, y):
 * 'red' = left-eye-only light, 'cyan' = right-eye-only light. Dimmer pixels (e.g. the
 * half-intensity fusion frame) are excluded by a relative threshold.
 */
export async function channelCentroid(
  page: Page,
  at: { x: number; y: number },
  radius: number,
  channel: 'red' | 'cyan',
): Promise<{ x: number; y: number; n: number } | null> {
  return page.evaluate(
    ({ at, radius, channel }) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=training-canvas]');
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return null;
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const sy = c.height / rect.height;
      const x0 = Math.max(0, Math.floor((at.x - rect.left - radius) * sx));
      const y0 = Math.max(0, Math.floor((at.y - rect.top - radius) * sy));
      const x1 = Math.min(c.width, Math.ceil((at.x - rect.left + radius) * sx));
      const y1 = Math.min(c.height, Math.ceil((at.y - rect.top + radius) * sy));
      if (x1 <= x0 || y1 <= y0) return null;
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const value = (i: number) => (channel === 'red' ? d[i]! : Math.min(d[i + 1]!, d[i + 2]!));
      const other = (i: number) => (channel === 'red' ? Math.max(d[i + 1]!, d[i + 2]!) : d[i]!);
      let max = 0;
      for (let i = 0; i < d.length; i += 4) if (other(i) < 40 && value(i) > max) max = value(i);
      if (max < 60) return null;
      let tx = 0;
      let ty = 0;
      let n = 0;
      const w = x1 - x0;
      for (let i = 0; i < d.length; i += 4) {
        if (other(i) < 40 && value(i) >= max * 0.8) {
          const p = i / 4;
          tx += p % w;
          ty += Math.floor(p / w);
          n++;
        }
      }
      if (!n) return null;
      return { x: rect.left + (x0 + tx / n) / sx, y: rect.top + (y0 + ty / n) / sy, n };
    },
    { at, radius, channel },
  );
}
