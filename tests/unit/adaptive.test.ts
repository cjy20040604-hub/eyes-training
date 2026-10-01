import { describe, expect, it } from 'vitest';
import {
  canStepUpGame,
  canStepUpVisual,
  initialProgress,
  moveTowardTier,
  stepBackVisual,
  stepUpGame,
  stepUpVisual,
  tierForValue,
} from '../../src/modules/adaptive';
import { l1Module } from '../../src/modules/l1';
import { l2Module } from '../../src/modules/l2';
import { makeCalibration, makeSettings } from '../fixtures/factories';

const calibration = makeCalibration({
  contrastBalance: { dominantEye: 'right', balanceRatio: 0.5, trials: 6 },
});
const ctx = {
  settings: makeSettings(),
  calibration,
  today: '2026-09-05',
  nowIso: '2026-09-05T10:00:00.000Z',
};

describe('intensity mapping', () => {
  it('L1 tiers are derived from the calibrated balance point', () => {
    expect(l1Module.intensity.valueForTier('low', calibration)).toBeCloseTo(0.5);
    // 0.5 + 0.5 * 0.25 = 0.625, rounded to two decimals for a stable metric value.
    expect(l1Module.intensity.valueForTier('medium', calibration)).toBeCloseTo(0.63);
    expect(l1Module.intensity.valueForTier('high', calibration)).toBeCloseTo(0.75);
    expect(tierForValue(l1Module, 0.7, calibration)).toBe('medium');
    expect(tierForValue(l1Module, 0.75, calibration)).toBe('high');
  });
  it('L2 tiers are percent of compensation removed and require clinician agreement to increase', () => {
    expect(l2Module.intensity.valueForTier('low', calibration)).toBe(0);
    expect(l2Module.intensity.valueForTier('high', calibration)).toBe(20);
    expect(l2Module.intensity.requiresClinician).toBe(true);
  });
});

describe('adaptive steps', () => {
  it('steps up visual difficulty by at most maxStepPerSession', () => {
    const p = initialProgress(l1Module, calibration, 'low');
    const next = stepUpVisual(l1Module, p, ctx);
    expect(next.intensityValue).toBeCloseTo(0.55);
    expect(next.lastVisualChangeAt).toBe(ctx.nowIso);
  });

  it('never changes visual and game difficulty on the same day', () => {
    const p = stepUpVisual(l1Module, initialProgress(l1Module, calibration, 'low'), ctx);
    expect(canStepUpGame(p, ctx)).toBe(false);
    expect(stepUpGame(p, ctx)).toBe(p);
    const g = stepUpGame(initialProgress(l1Module, calibration, 'low'), ctx);
    expect(g.gameDifficulty).toBe(2);
    expect(canStepUpVisual(l1Module, g, ctx)).toBe(false);
  });

  it('steps back immediately on discomfort regardless of locks', () => {
    const locked = {
      ...ctx,
      settings: makeSettings({ progressionLock: { locked: true, reason: '', since: null } }),
    };
    const p = { ...initialProgress(l1Module, calibration, 'high'), intensityValue: 0.75 };
    const back = stepBackVisual(l1Module, p, locked);
    expect(back.intensityValue).toBeCloseTo(0.65);
    expect(back.intensityTier).toBe('medium');
  });

  it('refuses to step up while progression is locked', () => {
    const locked = {
      ...ctx,
      settings: makeSettings({ progressionLock: { locked: true, reason: '', since: null } }),
    };
    const p = initialProgress(l1Module, calibration, 'low');
    expect(canStepUpVisual(l1Module, p, locked)).toBe(false);
    expect(stepUpVisual(l1Module, p, locked)).toBe(p);
  });

  it('refuses to make L2 harder without clinician agreement', () => {
    const p = initialProgress(l2Module, calibration, 'low');
    expect(canStepUpVisual(l2Module, p, ctx)).toBe(false);
    const withClinician = { ...ctx, settings: makeSettings({ clinicianAgreement: true }) };
    expect(stepUpVisual(l2Module, p, withClinician).intensityValue).toBe(5);
  });

  it('moveTowardTier never jumps: harder target is approached one step, easier is applied at once', () => {
    const p = initialProgress(l1Module, calibration, 'low');
    const toward = moveTowardTier(l1Module, p, 'high', ctx);
    expect(toward.intensityValue).toBeCloseTo(0.55);
    const high = { ...initialProgress(l1Module, calibration, 'high') };
    const easier = moveTowardTier(l1Module, high, 'low', ctx);
    expect(easier.intensityValue).toBeCloseTo(0.5);
  });

  it('clamps within bounds', () => {
    let p = { ...initialProgress(l1Module, calibration, 'low'), intensityValue: 0.06 };
    p = stepBackVisual(l1Module, p, ctx);
    expect(p.intensityValue).toBe(0.05);
  });
});
