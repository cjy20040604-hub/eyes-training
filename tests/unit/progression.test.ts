import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameLoop } from '../../src/engine/frameLoop';
import { autoAdvance, initialProgress, moveTowardTier, tierForValue } from '../../src/modules/adaptive';
import { l1Module } from '../../src/modules/l1';
import { l2Module } from '../../src/modules/l2';
import { makeCalibration, makeSettings } from '../fixtures/factories';

const calibration = makeCalibration({
  contrastBalance: { dominantEye: 'right', balanceRatio: 0.5, trials: 6 },
});
const day = (d: string) => ({
  settings: makeSettings(),
  calibration,
  today: d,
  nowIso: `${d}T10:00:00.000Z`,
});

describe('day-to-day progression', () => {
  it('starting a session at the planned tier does not stamp a change (bug: blocked all progression)', () => {
    const p = initialProgress(l1Module, calibration, 'low');
    const started = moveTowardTier(l1Module, p, 'low', day('2026-10-05'));
    expect(started).toBe(p);
    expect(started.lastVisualChangeAt).toBeNull();
  });

  it('a 100% balance point (all tiers equal) is labelled low and does not block progression', () => {
    const full = makeCalibration({
      contrastBalance: { dominantEye: 'right', balanceRatio: 1, trials: 2 },
    });
    expect(tierForValue(l1Module, 1, full)).toBe('low');
    const p = initialProgress(l1Module, full, 'low');
    const ctx = { settings: makeSettings(), calibration: full, today: '2026-10-05' };
    expect(moveTowardTier(l1Module, p, 'low', ctx)).toBe(p);
    expect(autoAdvance(l1Module, p, 'good', 'low', ctx).change).toBe('game-up');
  });

  it('keeps progress that is still inside the planned tier from one day to the next', () => {
    const p = { ...initialProgress(l1Module, calibration, 'low'), intensityValue: 0.6 };
    expect(moveTowardTier(l1Module, p, 'low', day('2026-10-06')).intensityValue).toBe(0.6);
  });

  it('a good day raises game difficulty first, at most one step per day', () => {
    let p = initialProgress(l2Module, calibration, 'low');
    const d1 = autoAdvance(l2Module, p, 'good', 'low', day('2026-10-05'));
    expect(d1.change).toBe('game-up');
    p = d1.progress;
    expect(p.gameDifficulty).toBe(2);
    // A second good session the same day changes nothing.
    const again = autoAdvance(l2Module, p, 'good', 'low', day('2026-10-05'));
    expect(again.change).toBeNull();
    // Next day: one more step.
    const d2 = autoAdvance(l2Module, p, 'good', 'low', day('2026-10-06'));
    expect(d2.progress.gameDifficulty).toBe(3);
  });

  it('after game level 3, L1 visual difficulty steps up but never past the planned tier', () => {
    let p = { ...initialProgress(l1Module, calibration, 'low'), gameDifficulty: 3 };
    const d1 = autoAdvance(l1Module, p, 'good', 'low', day('2026-10-05'));
    expect(d1.change).toBe('visual-up');
    expect(d1.progress.intensityValue).toBeCloseTo(0.55);
    p = d1.progress;
    const d2 = autoAdvance(l1Module, p, 'good', 'low', day('2026-10-06'));
    expect(d2.progress.intensityValue).toBeCloseTo(0.6);
    // 0.65 would enter the medium tier, so with a low plan it raises game difficulty instead.
    const d3 = autoAdvance(l1Module, d2.progress, 'good', 'low', day('2026-10-07'));
    expect(d3.change).toBe('game-up');
    expect(d3.progress.intensityValue).toBeCloseTo(0.6);
  });

  it('L2 visual difficulty (prism reduction) never rises without clinician agreement', () => {
    const p = { ...initialProgress(l2Module, calibration, 'low'), gameDifficulty: 5 };
    const r = autoAdvance(l2Module, p, 'good', 'high', day('2026-10-05'));
    expect(r.change).toBeNull();
    expect(r.progress.intensityValue).toBe(0);
  });

  it('a poor session eases game difficulty; ok changes nothing', () => {
    const p = { ...initialProgress(l1Module, calibration, 'low'), gameDifficulty: 3 };
    expect(autoAdvance(l1Module, p, 'poor', 'low', day('2026-10-05')).progress.gameDifficulty).toBe(2);
    expect(autoAdvance(l1Module, p, 'ok', 'low', day('2026-10-05')).change).toBeNull();
  });

  it('nothing rises while progression is locked', () => {
    const p = initialProgress(l1Module, calibration, 'low');
    const locked = {
      ...day('2026-10-05'),
      settings: makeSettings({ progressionLock: { locked: true, reason: 'diplopia', since: null } }),
    };
    expect(autoAdvance(l1Module, p, 'good', 'low', locked).change).toBeNull();
  });
});

describe('FrameLoop visibility handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('pauses while the page is hidden and resumes when it is visible again', () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => queue.splice(0));
    const flush = (now: number) => {
      const batch = queue.splice(0);
      batch.forEach((cb) => cb(now));
    };
    const setVisibility = (v: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    const frames: number[] = [];
    const loop = new FrameLoop((dt) => frames.push(dt));
    loop.start();
    flush(0);
    flush(16);
    expect(frames).toEqual([0, 16]);

    setVisibility('hidden');
    expect(loop.isRunning).toBe(false);
    flush(5000);
    expect(frames).toHaveLength(2);

    setVisibility('visible');
    expect(loop.isRunning).toBe(true);
    flush(60000);
    flush(60016);
    // First frame after resuming has dt 0: no giant jump after a long absence.
    expect(frames.slice(2)).toEqual([0, 16]);
    loop.dispose();
  });

  it('an explicit pause is not undone by visibility changes', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const loop = new FrameLoop(() => {});
    loop.start();
    loop.pause();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(loop.isRunning).toBe(false);
    loop.dispose();
  });
});
