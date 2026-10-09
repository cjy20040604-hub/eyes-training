import type { CalibrationProfile, IntensityTier, ModuleId, SessionEvent } from '../data/schema';
import type { EyeLayer, RenderOptions } from '../engine/renderer';
import type { TransitionGuard } from '../engine/transitionGuard';
import type { ScreenGeometry } from '../engine/units';

/**
 * Every module separates VISUAL difficulty (the intensity metric, e.g. dominant-eye
 * contrast) from GAME difficulty (speed, size, timing). They never change together.
 */
export interface IntensityMap {
  /** Metric id, also used as an i18n key: modules.metrics.<metric>. */
  metric: string;
  unit: string;
  /** Concrete value for a tier, given the calibration. */
  valueForTier(tier: IntensityTier, calibration: CalibrationProfile): number;
  /** Bounds for the metric given the calibration. */
  bounds(calibration: CalibrationProfile): { min: number; max: number };
  /** Largest change allowed per session (absolute, in metric units). */
  maxStepPerSession: number;
  /** Absolute amount to step back on discomfort. */
  stepBack: number;
  /** +1 if a larger value is harder, -1 if smaller is harder. */
  harderDirection: 1 | -1;
  /** Whether stepping harder on this metric needs clinician agreement (offset reduction). */
  requiresClinician: boolean;
  format(value: number): string;
}

/**
 * Inputs delivered to a module.
 *  - direction: the currently HELD direction (keyboard / gamepad), each axis in -1..1.
 *    {0, 0} means released. Sent whenever it changes, not on every key repeat.
 *  - pointer: a tap/click/drag position in CSS px of the stimulus canvas.
 *  - action: Space / Enter / tap button / gamepad A (one per press).
 */
export type ModuleInput =
  | { type: 'direction'; dx: number; dy: number }
  | { type: 'action' }
  | { type: 'pointer'; x: number; y: number; down: boolean };

/** How well a session went, used for gentle day-to-day progression. */
export type Performance = 'good' | 'ok' | 'poor';

export interface HudState {
  /** i18n key of the current prompt shown outside the stimulus area. */
  promptKey: string;
  score: number;
  /** 0..1 progress indicator for the current round, if any. */
  roundProgress: number | null;
}

export interface ModuleRuntimeContext {
  calibration: CalibrationProfile;
  geometry: ScreenGeometry;
  intensityValue: number;
  gameDifficulty: number;
  guard: TransitionGuard;
  reducedMotion: boolean;
  width: number;
  height: number;
  emit(type: SessionEvent['type'], data?: SessionEvent['data']): void;
  random: () => number;
}

export interface ModuleInstance {
  start(nowMs: number): void;
  update(dtMs: number, nowMs: number): void;
  draw(layers: { left: EyeLayer; right: EyeLayer }): void;
  input(input: ModuleInput): void;
  resize(width: number, height: number): void;
  /** Per-frame overrides of render options (e.g. contrast for this module). */
  renderOverrides(base: RenderOptions): RenderOptions;
  hud(): HudState;
  metrics(): Record<string, number>;
  stop(): void;
}

export interface ModuleDefinition {
  id: ModuleId;
  /** Short code shown in UI, e.g. "L1". */
  code: string;
  minMinutes: number;
  maxMinutes: number;
  defaultMinutes: number;
  intensity: IntensityMap;
  /** Phase 1 modules are implemented; others are listed but not runnable yet. */
  implemented: boolean;
  create(ctx: ModuleRuntimeContext): ModuleInstance;
  /** Rate a finished session from its metrics and actual minutes. */
  assess(metrics: Record<string, number>, minutes: number): Performance;
}
