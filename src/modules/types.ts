import type { ComponentType } from 'react';
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
  /** Interpolation values for the prompt (e.g. the current vergence demand). */
  promptParams?: Record<string, string | number>;
  score: number;
  /** 0..1 progress indicator for the current round, if any. */
  roundProgress: number | null;
}

/** Per-session settings chosen before a module starts (e.g. the video file). */
export type ModuleConfig = Record<string, string | number | boolean>;

export interface ModuleRuntimeContext {
  calibration: CalibrationProfile;
  geometry: ScreenGeometry;
  intensityValue: number;
  gameDifficulty: number;
  guard: TransitionGuard;
  reducedMotion: boolean;
  width: number;
  height: number;
  /** Device pixel ratio of the stimulus canvas (for sub-CSS-pixel disparities). */
  dpr: number;
  config: ModuleConfig;
  emit(type: SessionEvent['type'], data?: SessionEvent['data']): void;
  random: () => number;
}

/** A named object on screen, in the eye layer's CSS px (before that eye's prism offset). */
export interface ProbePoint {
  x: number;
  y: number;
  eye: 'left' | 'right';
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
  /** Called when breaks, overlays or STOP pause/resume the session (e.g. to pause a video). */
  setPaused?(paused: boolean): void;
  /**
   * Test hook: positions of the module's key objects. Only read by end-to-end test builds
   * (vite --mode e2e), so tests can aim at objects without scanning rendered pixels.
   */
  probe?(): Record<string, ProbePoint>;
  stop(): void;
}

/** Props for a module's optional setup step, shown before the pre-session check. */
export interface ModuleSetupProps {
  onChange(config: ModuleConfig | null): void;
}

export interface ModuleDefinition {
  id: ModuleId;
  /** Short code shown in UI, e.g. "L1". */
  code: string;
  minMinutes: number;
  maxMinutes: number;
  defaultMinutes: number;
  intensity: IntensityMap;
  /** Modules that are listed but not runnable yet. */
  implemented: boolean;
  /**
   * Whether the user is expected to give input continuously. If true, 60 s without any
   * input pauses the session ("honest dose": idle time is not counted as training).
   */
  requiresInput: boolean;
  /** Idle time before that pause, if not the default (e.g. longer for reading a page). */
  idlePauseMs?: number;
  /** Tested for VR headsets (WebXR): plays in the headset when the VR renderer is chosen. */
  vrReady?: boolean;
  /** The module runs its own one-eye-only check points (L1's chick), so skip the shared ones. */
  ownCatchTrials?: boolean;
  /** Optional setup component; the session cannot start until it reports a config. */
  setup?: ComponentType<ModuleSetupProps>;
  create(ctx: ModuleRuntimeContext): ModuleInstance;
  /** Rate a finished session from its metrics and actual minutes. */
  assess(metrics: Record<string, number>, minutes: number): Performance;
}
