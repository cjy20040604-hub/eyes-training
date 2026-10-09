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
  const low = def.intensity.valueForTier('low', calibration);
  const med = def.intensity.valueForTier('medium', calibration);
  const high = def.intensity.valueForTier('high', calibration);
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const atLeast = (v: number, t: number) => (dir === 1 ? v >= t - 1e-9 : v <= t + 1e-9);
  // Tiers that share a value (e.g. a 100% balance point makes all three equal) collapse
  // into the lowest one, so a value is never labelled harder than it really is.
  if (!same(high, med) && atLeast(value, high)) return 'high';
  if (!same(med, low) && atLeast(value, med)) return 'medium';
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

const TIER_RANK: Record<IntensityTier, number> = { low: 0, medium: 1, high: 2 };

/**
 * Apply the daily plan's target tier at session start. The planned tier acts as a band:
 *  - progress already inside the planned tier is left exactly as it is (no change, no
 *    timestamp), so automatic progression within the band is kept from day to day;
 *  - progress above the planned tier drops to that tier at once (easier is always allowed);
 *  - progress below the planned tier moves up by at most one small step per day.
 */
export function moveTowardTier(
  def: ModuleDefinition,
  p: ModuleProgress,
  targetTier: IntensityTier,
  ctx: AdaptiveContext,
): ModuleProgress {
  const currentTier = tierForValue(def, p.intensityValue, ctx.calibration);
  if (TIER_RANK[currentTier] === TIER_RANK[targetTier]) {
    return currentTier === p.intensityTier ? p : { ...p, intensityTier: currentTier };
  }
  if (TIER_RANK[currentTier] > TIER_RANK[targetTier]) {
    return {
      ...p,
      intensityValue: def.intensity.valueForTier(targetTier, ctx.calibration),
      intensityTier: targetTier,
      lastVisualChangeAt: ctx.nowIso ?? new Date().toISOString(),
    };
  }
  return stepUpVisual(def, p, ctx);
}

export type ProgressChange = 'game-up' | 'visual-up' | 'game-down' | null;

/**
 * Gentle automatic progression after a COMPLETED session with a clean post-session check.
 *  - poor performance: game difficulty eases one level (always allowed);
 *  - good performance: one small step up, at most once per day, never both kinds together.
 *    Game difficulty goes first up to level 3, then visual difficulty, as long as the
 *    visual step stays inside the planned tier and clinician gating allows it;
 *  - nothing goes up while progression is locked.
 */
export function autoAdvance(
  def: ModuleDefinition,
  p: ModuleProgress,
  performance: 'good' | 'ok' | 'poor',
  planTier: IntensityTier,
  ctx: AdaptiveContext,
): { progress: ModuleProgress; change: ProgressChange } {
  if (performance === 'poor') {
    if (p.gameDifficulty > 1) return { progress: stepBackGame(p, ctx), change: 'game-down' };
    return { progress: p, change: null };
  }
  if (performance !== 'good') return { progress: p, change: null };

  const visualStaysInPlan = (): boolean => {
    const next = p.intensityValue + def.intensity.harderDirection * def.intensity.maxStepPerSession;
    const { min, max } = def.intensity.bounds(ctx.calibration);
    const clamped = Math.max(min, Math.min(max, next));
    return TIER_RANK[tierForValue(def, clamped, ctx.calibration)] <= TIER_RANK[planTier];
  };
  const tryGame = () =>
    canStepUpGame(p, ctx) ? { progress: stepUpGame(p, ctx), change: 'game-up' as const } : null;
  const tryVisual = () =>
    canStepUpVisual(def, p, ctx) && visualStaysInPlan()
      ? { progress: stepUpVisual(def, p, ctx), change: 'visual-up' as const }
      : null;

  const result = p.gameDifficulty < 3 ? (tryGame() ?? tryVisual()) : (tryVisual() ?? tryGame());
  return result ?? { progress: p, change: null };
}
