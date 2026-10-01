import type { CalibrationProfile, IntensityTier, ModuleProgress, Settings } from '../data/schema';
import { dayKey } from '../data/util';
import type { ModuleDefinition } from './types';

/**
 * Adaptive rules:
 *  - tiny steps, capped per session (maxStepPerSession on the module's metric);
 *  - instant step back on diplopia / discomfort / repeated failure;
 *  - visual difficulty and game difficulty never change on the same day;
 *  - nothing advances while progression is locked;
 *  - metrics flagged requiresClinician can only get harder with the clinician toggle on.
 */

export function initialProgress(
  def: ModuleDefinition,
  calibration: CalibrationProfile,
  tier: IntensityTier,
): ModuleProgress {
  return {
    intensityValue: def.intensity.valueForTier(tier, calibration),
    intensityTier: tier,
    gameDifficulty: 1,
    lastVisualChangeAt: null,
    lastGameChangeAt: null,
  };
}

export function tierForValue(
  def: ModuleDefinition,
  value: number,
  calibration: CalibrationProfile,
): IntensityTier {
  const dir = def.intensity.harderDirection;
  const med = def.intensity.valueForTier('medium', calibration);
  const high = def.intensity.valueForTier('high', calibration);
  const atLeast = (v: number, t: number) => (dir === 1 ? v >= t - 1e-9 : v <= t + 1e-9);
  if (atLeast(value, high)) return 'high';
  if (atLeast(value, med)) return 'medium';
  return 'low';
}

function clampToBounds(def: ModuleDefinition, value: number, calibration: CalibrationProfile): number {
  const { min, max } = def.intensity.bounds(calibration);
  return Math.max(min, Math.min(max, value));
}

function changedToday(iso: string | null, today: string): boolean {
  return !!iso && dayKey(new Date(iso)) === today;
}

export interface AdaptiveContext {
  settings: Pick<Settings, 'progressionLock' | 'clinicianAgreement'>;
  calibration: CalibrationProfile;
  today?: string;
  nowIso?: string;
}

export function canStepUpVisual(def: ModuleDefinition, p: ModuleProgress, ctx: AdaptiveContext): boolean {
  const today = ctx.today ?? dayKey();
  if (ctx.settings.progressionLock.locked) return false;
  if (def.intensity.requiresClinician && !ctx.settings.clinicianAgreement) return false;
  if (changedToday(p.lastVisualChangeAt, today) || changedToday(p.lastGameChangeAt, today)) return false;
  const { min, max } = def.intensity.bounds(ctx.calibration);
  return def.intensity.harderDirection === 1 ? p.intensityValue < max : p.intensityValue > min;
}

export function stepUpVisual(def: ModuleDefinition, p: ModuleProgress, ctx: AdaptiveContext): ModuleProgress {
  if (!canStepUpVisual(def, p, ctx)) return p;
  const next = clampToBounds(
    def,
    p.intensityValue + def.intensity.harderDirection * def.intensity.maxStepPerSession,
    ctx.calibration,
  );
  return {
    ...p,
    intensityValue: next,
    intensityTier: tierForValue(def, next, ctx.calibration),
    lastVisualChangeAt: ctx.nowIso ?? new Date().toISOString(),
  };
}

/** Always allowed: discomfort or repeated failure steps visual difficulty back immediately. */
export function stepBackVisual(
  def: ModuleDefinition,
  p: ModuleProgress,
  ctx: AdaptiveContext,
): ModuleProgress {
  const next = clampToBounds(
    def,
    p.intensityValue - def.intensity.harderDirection * def.intensity.stepBack,
    ctx.calibration,
  );
  return {
    ...p,
    intensityValue: next,
    intensityTier: tierForValue(def, next, ctx.calibration),
    lastVisualChangeAt: ctx.nowIso ?? new Date().toISOString(),
  };
}

export function canStepUpGame(p: ModuleProgress, ctx: AdaptiveContext): boolean {
  const today = ctx.today ?? dayKey();
  if (ctx.settings.progressionLock.locked) return false;
  if (changedToday(p.lastVisualChangeAt, today) || changedToday(p.lastGameChangeAt, today)) return false;
  return p.gameDifficulty < 5;
}

export function stepUpGame(p: ModuleProgress, ctx: AdaptiveContext): ModuleProgress {
  if (!canStepUpGame(p, ctx)) return p;
  return {
    ...p,
    gameDifficulty: p.gameDifficulty + 1,
    lastGameChangeAt: ctx.nowIso ?? new Date().toISOString(),
  };
}

export function stepBackGame(p: ModuleProgress, ctx: AdaptiveContext): ModuleProgress {
  return {
    ...p,
    gameDifficulty: Math.max(1, p.gameDifficulty - 1),
    lastGameChangeAt: ctx.nowIso ?? new Date().toISOString(),
  };
}

/** Set the tier directly (from the daily plan) but never jump more than one step per session. */
export function moveTowardTier(
  def: ModuleDefinition,
  p: ModuleProgress,
  targetTier: IntensityTier,
  ctx: AdaptiveContext,
): ModuleProgress {
  const target = def.intensity.valueForTier(targetTier, ctx.calibration);
  const dir = def.intensity.harderDirection;
  const harder = dir === 1 ? target > p.intensityValue : target < p.intensityValue;
  if (!harder) {
    // Easier is always allowed instantly.
    return {
      ...p,
      intensityValue: target,
      intensityTier: targetTier,
      lastVisualChangeAt: ctx.nowIso ?? new Date().toISOString(),
    };
  }
  return stepUpVisual(def, p, ctx);
}
