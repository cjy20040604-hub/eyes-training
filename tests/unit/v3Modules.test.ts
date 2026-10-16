import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StereoProbe,
  alignmentJitter,
  baseline,
  checkDue,
  daysUntilNextCheck,
  stereoTrialImage,
  summarizeAlignment,
} from '../../src/assessment/checkLogic';
import type { Assessment } from '../../src/data/schema';
import { mulberry32 } from '../../src/engine/random';
import {
  VR_MAX_SESSION_MINUTES,
  eyePanelMatrix,
  immersiveVrSupported,
  vrLayout,
  xrDirection,
} from '../../src/engine/renderer/xr';
import { TransitionGuard } from '../../src/engine/transitionGuard';
import { prismDioptersToPx, pxToPrismDiopters, type ScreenGeometry } from '../../src/engine/units';
import {
  BEAD_T,
  BrockInstance,
  MAX_DIVERGENCE_DELTA,
  assessBrock,
  stringDemand,
} from '../../src/modules/brock';
import { ReadingInstance, assessReading, layoutPages, tokenize } from '../../src/modules/reading';
import type { ModuleRuntimeContext } from '../../src/modules/types';
import { SCENE_H, SCENE_IDS, SCENE_W, SceneSource } from '../../src/modules/video/scenes';
import { VideoInstance } from '../../src/modules/video';
import { initI18n } from '../../src/i18n';
import { makeCalibration } from '../fixtures/factories';

void initI18n('en');

const geometry: ScreenGeometry = { distanceM: 0.6, ppi: 96 };

function ctx(over: Partial<ModuleRuntimeContext> = {}): ModuleRuntimeContext {
  return {
    calibration: makeCalibration(),
    geometry,
    intensityValue: 4,
    gameDifficulty: 1,
    guard: new TransitionGuard(),
    reducedMotion: false,
    width: 1000,
    height: 700,
    dpr: 1,
    config: {},
    emit: () => {},
    random: mulberry32(1),
    ...over,
  };
}

function check(at: string, over: Partial<Assessment> = {}): Assessment {
  return {
    id: `a_${at}`,
    at,
    day: at.slice(0, 10),
    calibrationId: 'cal',
    viewingDistanceCm: 60,
    status: 'completed',
    worth: { dotsSeen: 4, alternating: false, result: 'fusion' },
    alignment: { horizontalDelta: [1, 2], verticalDelta: [0, 0], meanDelta: 1.5, spreadDelta: 1 },
    balance: { ratio: 0.6, trials: 8 },
    stereo: { thresholdArcsec: 300, trials: 20, correct: 12, cantTell: 2, minArcsec: 40 },
    preCheckId: null,
    postCheckId: null,
    notes: '',
    ...over,
  };
}

describe('weekly check logic', () => {
  it('is due without any check, then a week after the last completed one', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(checkDue([], now)).toBe(true);
    expect(checkDue([check('2026-10-12T12:00:00Z')], now)).toBe(false);
    expect(daysUntilNextCheck([check('2026-10-12T12:00:00Z')], now)).toBe(3);
    expect(checkDue([check('2026-10-09T11:00:00Z')], now)).toBe(true);
    // A stopped check does not count.
    expect(checkDue([check('2026-10-15T12:00:00Z', { status: 'stopped' })], now)).toBe(true);
  });

  it('the baseline is the mean of the first two completed checks', () => {
    const b = baseline([
      check('2026-10-20T10:00:00Z', {
        stereo: { thresholdArcsec: 100, trials: 1, correct: 1, cantTell: 0, minArcsec: 40 },
      }),
      check('2026-10-01T10:00:00Z', {
        stereo: { thresholdArcsec: 400, trials: 1, correct: 1, cantTell: 0, minArcsec: 40 },
      }),
      check('2026-10-08T10:00:00Z', {
        stereo: { thresholdArcsec: 200, trials: 1, correct: 1, cantTell: 0, minArcsec: 40 },
      }),
    ]);
    expect(b?.checks).toBe(2);
    expect(b?.stereoArcsec).toBe(300);
    expect(b?.balancePercent).toBe(60);
    expect(baseline([])).toBeNull();
  });

  it('converts alignment from px to signed Δ with a spread', () => {
    const px = prismDioptersToPx(1, geometry);
    const a = summarizeAlignment([px, -px * 0.5], [0, px], geometry);
    expect(a.horizontalDelta).toEqual([1, -0.5]);
    expect(a.meanDelta).toBeCloseTo(0.25, 2);
    expect(a.spreadDelta).toBeCloseTo(1.5, 2);
    expect(a.verticalDelta[1]).toBeCloseTo(1, 2);
  });

  it('starts each alignment trial off-centre, alternating sides', () => {
    const r = mulberry32(3);
    const a = alignmentJitter(0, r);
    const b = alignmentJitter(1, r);
    expect(a.dx).toBeGreaterThanOrEqual(18);
    expect(b.dx).toBeLessThanOrEqual(-18);
  });

  it('stereo probe: a perfect observer reaches a fine threshold; "can\'t tell" gives none', () => {
    const good = new StereoProbe(geometry, 1, mulberry32(5));
    while (!good.done) good.respond(good.current.side);
    const g = good.result();
    expect(g.thresholdArcsec).not.toBeNull();
    expect(g.thresholdArcsec!).toBeLessThan(800);
    expect(g.correct).toBe(g.trials);

    const none = new StereoProbe(geometry, 1, mulberry32(5));
    while (!none.done) none.respond(null);
    expect(none.result()).toMatchObject({ thresholdArcsec: null, trials: 30, cantTell: 30 });
  });

  it('stereo patterns are the same whenever a trial is redrawn, and disparity is whole device pixels', () => {
    const args = { width: 640, height: 360, geometry, dpr: 2, arcsec: 300, side: 'left' as const, seed: 42 };
    const a = stereoTrialImage(args);
    const b = stereoTrialImage(args);
    expect(a.image.left).toEqual(b.image.left);
    expect(a.disparityPx * 2).toBe(Math.round(a.disparityPx * 2));
    expect(stereoTrialImage({ ...args, seed: 43 }).image.left).not.toEqual(a.image.left);
  });
});

describe('VR geometry', () => {
  it('keeps the angular size of the calibrated screen', () => {
    const layout = vrLayout(geometry, 1000, 700, 1.5);
    const screenWidthM = (1000 / 96) * 0.0254;
    // Same angle: width / distance is the same on the panel and on the screen.
    expect(layout.widthM / layout.distanceM).toBeCloseTo(screenWidthM / geometry.distanceM, 6);
    expect(layout.heightM / layout.widthM).toBeCloseTo(0.7, 6);
  });

  it('places each eye’s panel with its prism offset (same Δ as on screen)', () => {
    const layout = vrLayout(geometry, 1000, 700, 1.5);
    const dx = -prismDioptersToPx(7, geometry); // 7Δ base-in on the left eye
    const m = eyePanelMatrix({ dx, dy: 0, rotationDeg: 0 }, layout);
    const shiftDelta = (Math.abs(m[12]!) / layout.distanceM) * 100; // 1Δ = 1 cm at 1 m
    expect(shiftDelta).toBeCloseTo(7, 1);
    expect(m[12]).toBeLessThan(0);
    expect(m[14]).toBe(-1.5);
    expect(m[0]).toBeCloseTo(layout.widthM, 6);
    // Screen y down = world y down; clockwise on screen = negative rotation about z.
    const down = eyePanelMatrix({ dx: 0, dy: 10, rotationDeg: 0 }, layout);
    expect(down[13]).toBeLessThan(0);
    const cw = eyePanelMatrix({ dx: 0, dy: 0, rotationDeg: 5 }, layout);
    expect(cw[1]).toBeLessThan(0);
    expect(pxToPrismDiopters(Math.abs(dx), geometry)).toBeCloseTo(7, 6);
  });

  it('reads the thumbstick with a dead zone (xr-standard axes 2/3)', () => {
    expect(xrDirection([0, 0, 0.9, -0.1])).toEqual({ dx: 0.9, dy: 0 });
    expect(xrDirection([0.6, 0.5])).toEqual({ dx: 0.6, dy: 0.5 });
    expect(xrDirection([0, 0, 0.2, 0.2])).toEqual({ dx: 0, dy: 0 });
    expect(VR_MAX_SESSION_MINUTES).toBeLessThanOrEqual(10);
  });

  it('VR support needs navigator.xr, an immersive-vr session and XRWebGLLayer', async () => {
    expect(await immersiveVrSupported()).toBe(false);
    vi.stubGlobal('navigator', { ...navigator, xr: { isSessionSupported: async () => true } });
    expect(await immersiveVrSupported()).toBe(false);
    (window as unknown as { XRWebGLLayer: unknown }).XRWebGLLayer = class {};
    expect(await immersiveVrSupported()).toBe(true);
    delete (window as unknown as { XRWebGLLayer?: unknown }).XRWebGLLayer;
  });

  afterEach(() => vi.unstubAllGlobals());
});

describe('Brock string', () => {
  it('near bead asks for the set convergence, far bead at most 2Δ divergence', () => {
    expect(stringDemand(BEAD_T[0], 4)).toBeCloseTo(4, 6);
    expect(stringDemand(BEAD_T[2], 4)).toBeCloseTo(-2, 6);
    expect(stringDemand(BEAD_T[2], 2)).toBeCloseTo(-1, 6);
    expect(stringDemand(BEAD_T[2], 8)).toBeGreaterThanOrEqual(-MAX_DIVERGENCE_DELTA - 1e-9);
    expect(stringDemand(BEAD_T[1], 4)).toBeCloseTo(1, 6);
  });

  it('crossed disparity at the near bead: the left eye sees it to the right', () => {
    const b = new BrockInstance(ctx());
    b.start(0);
    const p = b.probe();
    expect(p['targetLeft']!.x).toBeGreaterThan(p['targetRight']!.x);
    const sep = p['targetLeft']!.x - p['targetRight']!.x;
    expect(pxToPrismDiopters(sep, geometry)).toBeCloseTo(4, 1);
  });

  it('confirming moves to the next bead; one-string reports are counted', () => {
    const events: string[] = [];
    const b = new BrockInstance(ctx({ emit: (_t, d) => events.push(String(d?.['brock'])) }));
    b.start(0);
    b.update(16, 1000);
    b.input({ type: 'action' });
    expect(b.hud().promptKey).toBe('modules.brock.prompt.look.near');
    b.update(16, 1100);
    expect(b.hud().promptKey).toBe('modules.brock.prompt.good');
    b.update(16, 3000);
    expect(b.targetBead).toBe(1);
    b.input({ type: 'direction', dx: 0, dy: 1 });
    b.update(16, 3100);
    expect(b.hud().promptKey).toBe('modules.brock.prompt.blink');
    // No answer: after the time limit the target moves on anyway.
    b.update(16, 3000 + 17_000);
    expect(b.targetBead).toBe(2);
    expect(b.metrics()).toMatchObject({ beadsConfirmed: 1, suppressionReports: 1, beadsShown: 3 });
    expect(events).toEqual(['cross', 'one-string']);
  });

  it('assessment', () => {
    expect(assessBrock({ beadsShown: 8, confirmRate: 0.9, suppressionReports: 0 }, 3)).toBe('good');
    expect(assessBrock({ beadsShown: 8, confirmRate: 0.2, suppressionReports: 3 }, 3)).toBe('poor');
    expect(assessBrock({ beadsShown: 2, confirmRate: 0 }, 3)).toBe('ok');
  });
});

describe('dichoptic reading', () => {
  it('splits words, or single Chinese characters with punctuation attached', () => {
    expect(tokenize('The old  harbour.')).toEqual(['The', 'old', 'harbour.']);
    expect(tokenize('清晨的阳光，慢慢。')).toEqual(['清', '晨', '的', '阳', '光，', '慢', '慢。']);
  });

  it('alternates eyes across the passage and wraps into lines and pages', () => {
    const pages = layoutPages(['aa', 'bb', 'cc', 'dd', 'ee'], (s) => s.length * 10, {
      width: 50,
      lineHeight: 20,
      linesPerPage: 2,
      spaced: true,
    });
    expect(pages.map((p) => p.map((t) => t.text))).toEqual([['aa', 'bb', 'cc', 'dd'], ['ee']]);
    expect(pages.flat().map((t) => t.eye)).toEqual(['left', 'right', 'left', 'right', 'left']);
    expect(pages[0]![2]!.y).toBe(20);
  });

  it('turns pages, records "words missing", and assesses', () => {
    const r = new ReadingInstance(ctx({ intensityValue: 0.6 }));
    r.start(0);
    r.update(16, 1000);
    r.input({ type: 'action' });
    r.update(16, 2000);
    r.input({ type: 'direction', dx: 1, dy: 0 });
    r.update(16, 2500);
    r.input({ type: 'direction', dx: 0, dy: 1 });
    r.update(16, 2600);
    expect(r.hud().promptKey).toBe('modules.reading.prompt.missing');
    const m = r.metrics();
    expect(m['pagesRead']).toBe(2);
    expect(m['wordsRead']).toBeGreaterThan(0);
    expect(m['missingReports']).toBe(1);
    expect(
      r.renderOverrides({
        transforms: { left: { dx: 0, dy: 0, rotationDeg: 0 }, right: { dx: 0, dy: 0, rotationDeg: 0 } },
        channels: makeCalibration().channels,
        contrast: { left: 1, right: 1 },
        backgroundGray: 0,
      }).contrast,
    ).toEqual({ left: 1, right: 0.6 });
    expect(assessReading({ pagesRead: 4, missingReports: 0 }, 5)).toBe('good');
    expect(assessReading({ pagesRead: 4, missingReports: 5 }, 5)).toBe('poor');
  });
});

describe('built-in calm scenes', () => {
  it('every scene animates slowly without errors', () => {
    for (const id of SCENE_IDS) {
      const s = new SceneSource(id, 1);
      expect(s.canvas.width).toBe(SCENE_W);
      expect(s.canvas.height).toBe(SCENE_H);
      for (let i = 0; i < 120; i++) s.update(16);
    }
  });

  it('the video module plays a scene without a file and counts watched time', () => {
    const v = new VideoInstance(
      ctx({ intensityValue: 0.3, config: { kind: 'scene', scene: 'clouds', name: 'Drifting clouds' } }),
    );
    expect(v.scene).not.toBeNull();
    v.start(0);
    for (let i = 0; i < 60; i++) v.update(50, i * 50);
    expect(v.metrics()['watchedSeconds']).toBe(3);
    v.setPaused(true);
    for (let i = 0; i < 20; i++) v.update(50, 3000 + i * 50);
    expect(v.metrics()['watchedSeconds']).toBe(3);
    expect(v.hud().promptKey).toBe('modules.video.prompt.watching');
    v.stop();
  });
});
