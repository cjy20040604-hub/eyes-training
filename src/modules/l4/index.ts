import type { IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { prismDioptersToPx } from '../../engine/units';
import { VergenceRamp, summarizeRounds } from '../../engine/vergence';
import { drawFusionFrame, grayCss, stimulusArea } from '../common';
import type {
  HudState,
  IntensityMap,
  ModuleDefinition,
  ModuleInput,
  ModuleInstance,
  ModuleRuntimeContext,
  Performance,
} from '../types';

/**
 * L4 "Stretch" — fusional vergence with break / recovery.
 *
 * Each eye gets a DIFFERENT target so neither can be ignored (an idea from anaglyph
 * vergence testing): the left eye sees a SQUARE, the right eye sees a CROSS, and both see
 * the frame. When fused, the cross sits inside the square. The whole of each eye's image
 * then separates slowly (base-out = convergence, then base-in = divergence, alternating).
 * The user presses Space the moment the cross leaves the square or doubles (BREAK); the
 * demand then reverses, and the user presses Space when it is single again (RECOVERY).
 *
 * Visual difficulty = the maximum demand in Δ (clinician agreement required to increase).
 * Divergence is capped lower than convergence; vertical demand is always zero.
 * Game difficulty = ramp speed and target size.
 */

const intensity: IntensityMap = {
  metric: 'vergenceDemandDelta',
  unit: 'Δ',
  valueForTier: (tier: IntensityTier) => (tier === 'low' ? 4 : tier === 'medium' ? 6 : 8),
  bounds: () => ({ min: 1, max: 12 }),
  maxStepPerSession: 1,
  stepBack: 2,
  harderDirection: 1,
  requiresClinician: true,
  format: (v) => `${(Math.round(v * 10) / 10).toFixed(1)}Δ`,
};

export class L4Instance implements ModuleInstance {
  readonly ramp: VergenceRamp;
  private readonly size: number;
  private promptKey = 'modules.l4.prompt.rest';
  private score = 0;
  private lastEarlyBreaks = 0;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.size = Math.max(36, 70 - (g - 1) * 8);
    this.ramp = new VergenceRamp({
      capDelta: ctx.intensityValue,
      rampUpPerSec: (ctx.reducedMotion ? 0.3 : 0.4) + (g - 1) * 0.05,
      rampDownPerSec: 1,
      restMs: 3000,
      holdMs: 3000,
    });
  }

  start(_nowMs: number): void {}

  update(dtMs: number, _nowMs: number): void {
    this.ramp.update(dtMs);
    const phase = this.ramp.phase;
    this.promptKey =
      phase === 'rest'
        ? this.lastEarlyBreaks >= 2
          ? 'modules.l4.prompt.easy'
          : 'modules.l4.prompt.rest'
        : phase === 'ramp-down'
          ? 'modules.l4.prompt.recover'
          : phase === 'hold'
            ? 'modules.l4.prompt.hold'
            : 'modules.l4.prompt.stretch';
  }

  /** Horizontal shift per eye in CSS px; the two eyes move apart by the full demand. */
  private eyeShiftPx(): number {
    return prismDioptersToPx(this.ramp.signedDemand, this.ctx.geometry) / 2;
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);
    const a = stimulusArea(this.ctx);
    const s = this.size;

    // LEFT eye: square with a nonius tick above.
    l.strokeStyle = grayCss(1);
    l.lineWidth = 5;
    l.strokeRect(a.cx - s / 2, a.cy - s / 2, s, s);
    l.beginPath();
    l.moveTo(a.cx, a.cy - s / 2 - 26);
    l.lineTo(a.cx, a.cy - s / 2 - 8);
    l.stroke();

    // RIGHT eye: cross with a nonius tick below.
    const c = s * 0.32;
    r.strokeStyle = grayCss(1);
    r.lineWidth = 5;
    r.beginPath();
    r.moveTo(a.cx - c, a.cy);
    r.lineTo(a.cx + c, a.cy);
    r.moveTo(a.cx, a.cy - c);
    r.lineTo(a.cx, a.cy + c);
    r.moveTo(a.cx, a.cy + s / 2 + 8);
    r.lineTo(a.cx, a.cy + s / 2 + 26);
    r.stroke();
  }

  input(input: ModuleInput): void {
    const isReport = input.type === 'action' || (input.type === 'pointer' && input.down);
    if (!isReport) return;
    const result = this.ramp.report();
    if (result === 'break') {
      this.ctx.emit('probe', { vergence: 'break', delta: this.ramp.demand, dir: this.ramp.direction });
    } else if (result === 'recovery') {
      const r = this.ramp.rounds[this.ramp.rounds.length - 1];
      this.score += 10;
      if (r && r.breakDelta !== null && r.breakDelta < 1) this.lastEarlyBreaks += 1;
      else this.lastEarlyBreaks = 0;
      this.ctx.emit('probe', { vergence: 'recovery', delta: r?.recoveryDelta ?? 0, dir: r?.direction ?? '' });
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    // Crossed disparity for base-out: the left eye's image moves right, the right eye's left.
    const shift = this.eyeShiftPx();
    return {
      ...base,
      transforms: {
        left: { ...base.transforms.left, dx: base.transforms.left.dx + shift },
        right: { ...base.transforms.right, dx: base.transforms.right.dx - shift },
      },
    };
  }

  hud(): HudState {
    const cap = this.ramp.cap;
    return {
      promptKey: this.promptKey,
      promptParams: {
        dir: this.ramp.direction,
        delta: (Math.round(this.ramp.demand * 10) / 10).toFixed(1),
      },
      score: this.score,
      roundProgress: cap > 0 ? this.ramp.demand / cap : null,
    };
  }

  metrics(): Record<string, number> {
    return summarizeRounds(this.ramp.rounds);
  }

  stop(): void {}
}

/**
 * Good: in convergence rounds the user stayed single up to at least 80% of the cap.
 * Poor: breaks below 1Δ on average. Otherwise ok.
 */
export function assessL4(metrics: Record<string, number>, _minutes: number): Performance {
  const rounds = metrics['rounds'] ?? 0;
  if (rounds < 2) return 'ok';
  const brk = metrics['meanBreakBO'];
  const max = metrics['maxDemandBO'] ?? 0;
  const noBreak = metrics['noBreakBO'] ?? 0;
  if (brk !== undefined && brk < 1) return 'poor';
  if (noBreak > 0 && max > 0) return 'good';
  if (brk !== undefined && max > 0 && brk >= max * 0.8) return 'good';
  return 'ok';
}

export const l4Module: ModuleDefinition = {
  id: 'l4',
  code: 'L4',
  minMinutes: 3,
  maxMinutes: 5,
  defaultMinutes: 3,
  intensity,
  implemented: true,
  // Long ramps can pass a minute without a key press; do not treat that as idle.
  requiresInput: false,
  create: (ctx) => new L4Instance(ctx),
  assess: assessL4,
};
