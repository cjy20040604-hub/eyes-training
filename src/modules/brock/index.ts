import type { IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { prismDioptersToPx } from '../../engine/units';
import { drawFusionFrame, grayCss, stimulusArea, type Point } from '../common';
import type {
  HudState,
  IntensityMap,
  ModuleDefinition,
  ModuleInput,
  ModuleInstance,
  ModuleRuntimeContext,
  Performance,
  ProbePoint,
} from '../types';

/**
 * Brock string (digital) — vergence awareness.
 *
 * A string runs from near (bottom of the picture) to far (top) with three beads. Each eye
 * sees the string from its own side: the screen disparity changes along the string, so the
 * near bead needs convergence and the far bead a little divergence. When the user really
 * looks at the highlighted bead, the two eyes' strings appear to cross exactly there (an
 * "X"); if one string fades, that eye is being suppressed. The idea comes from the classic
 * orthoptic Brock string and open digital versions (ideas only, written from scratch).
 *
 * The user presses Space when the strings cross at the highlighted bead, and Arrow Down
 * when one string disappears. The target bead moves near → middle → far → middle.
 *
 * Visual difficulty = convergence demand of the near bead in Δ (clinician agreement
 * required to raise it, like L4). Horizontal only; the far bead never asks for more than
 * 2Δ of divergence. Game difficulty = time per bead and bead size.
 */

const intensity: IntensityMap = {
  metric: 'brockNearDemandDelta',
  unit: 'Δ',
  valueForTier: (tier: IntensityTier) => (tier === 'low' ? 3 : tier === 'medium' ? 4.5 : 6),
  bounds: () => ({ min: 1, max: 8 }),
  maxStepPerSession: 0.5,
  stepBack: 1,
  harderDirection: 1,
  requiresClinician: true,
  format: (v) => `${(Math.round(v * 10) / 10).toFixed(1)}Δ`,
};

/** Positions of the beads along the string, from the near end (0) to the far end (1). */
export const BEAD_T = [0.18, 0.5, 0.82] as const;
/** Order in which the target bead moves. */
const ORDER = [0, 1, 2, 1] as const;
export const MAX_DIVERGENCE_DELTA = 2;

/** Disparity in Δ along the string (positive = crossed, needs convergence). */
export function stringDemand(t: number, nearDelta: number): number {
  const far = -Math.min(MAX_DIVERGENCE_DELTA, nearDelta / 2);
  return nearDelta + ((far - nearDelta) * (t - BEAD_T[0])) / (BEAD_T[2] - BEAD_T[0]);
}

type Phase = 'look' | 'well-done';

export class BrockInstance implements ModuleInstance {
  private step = 0;
  private phase: Phase = 'look';
  private phaseSince = 0;
  private now = 0;
  private readonly lookLimitMs: number;
  private readonly beadR: number;
  private shown = 0;
  private confirmed = 0;
  private suppressions = 0;
  private times: number[] = [];
  private score = 0;
  private promptKey = 'modules.brock.prompt.look.near';
  private suppressedAt = -Infinity;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.lookLimitMs = Math.max(8000, 16000 - (g - 1) * 2000);
    this.beadR = Math.max(6, 11 - (g - 1));
  }

  get targetBead(): number {
    return ORDER[this.step % ORDER.length] ?? 0;
  }

  start(nowMs: number): void {
    this.now = nowMs;
    this.phaseSince = nowMs;
    this.shown = 1;
  }

  private nextBead(nowMs: number): void {
    // Moving the highlight is a small change, but keep it inside the transition guard.
    if (!this.ctx.guard.request(nowMs, 'brock-target')) return;
    this.step += 1;
    this.phase = 'look';
    this.phaseSince = nowMs;
    this.shown += 1;
  }

  update(_dtMs: number, nowMs: number): void {
    this.now = nowMs;
    if (this.phase === 'well-done' && nowMs - this.phaseSince > 1500) this.nextBead(nowMs);
    else if (this.phase === 'look' && nowMs - this.phaseSince > this.lookLimitMs) this.nextBead(nowMs);
    const recentSuppression = nowMs - this.suppressedAt < 4000;
    this.promptKey =
      this.phase === 'well-done'
        ? 'modules.brock.prompt.good'
        : recentSuppression
          ? 'modules.brock.prompt.blink'
          : `modules.brock.prompt.look.${['near', 'middle', 'far'][this.targetBead] ?? 'middle'}`;
  }

  /** Screen geometry of the string: near end at the bottom, far end at the top. */
  private ends(): { near: Point; far: Point } {
    const a = stimulusArea(this.ctx);
    return { near: { x: a.cx, y: a.cy + a.halfH * 0.95 }, far: { x: a.cx, y: a.cy - a.halfH * 0.95 } };
  }

  private eyeShift(t: number): number {
    return prismDioptersToPx(stringDemand(t, this.ctx.intensityValue), this.ctx.geometry) / 2;
  }

  /** Where a point of the string appears for one eye (crossed disparity: left eye shifted right). */
  private pointFor(eye: 'left' | 'right', t: number): Point {
    const { near, far } = this.ends();
    const sign = eye === 'left' ? 1 : -1;
    return { x: near.x + (far.x - near.x) * t + sign * this.eyeShift(t), y: near.y + (far.y - near.y) * t };
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    for (const eye of ['left', 'right'] as const) {
      const c = layers[eye].begin();
      drawFusionFrame(c, this.ctx);
      const a = this.pointFor(eye, 0);
      const b = this.pointFor(eye, 1);
      c.strokeStyle = grayCss(0.8);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      BEAD_T.forEach((t, i) => {
        const p = this.pointFor(eye, t);
        c.fillStyle = grayCss(i === this.targetBead ? 1 : 0.7);
        c.beginPath();
        c.arc(p.x, p.y, this.beadR, 0, Math.PI * 2);
        c.fill();
        if (i === this.targetBead) {
          c.strokeStyle = grayCss(this.phase === 'well-done' ? 1 : 0.85);
          c.lineWidth = this.phase === 'well-done' ? 4 : 2;
          c.beginPath();
          c.arc(p.x, p.y, this.beadR + 9, 0, Math.PI * 2);
          c.stroke();
        }
      });
    }
  }

  input(input: ModuleInput): void {
    if (input.type === 'direction') {
      if (input.dy > 0 && input.dx === 0) {
        this.suppressions += 1;
        this.suppressedAt = this.now;
        this.ctx.emit('probe', { brock: 'one-string', bead: this.targetBead });
      }
      return;
    }
    const isConfirm = input.type === 'action' || (input.type === 'pointer' && input.down);
    if (!isConfirm || this.phase !== 'look') return;
    this.confirmed += 1;
    this.score += 10;
    this.times.push(this.now - this.phaseSince);
    this.phase = 'well-done';
    this.phaseSince = this.now;
    this.ctx.emit('probe', { brock: 'cross', bead: this.targetBead });
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    return base;
  }

  probe(): Record<string, ProbePoint> {
    const t = BEAD_T[this.targetBead] ?? 0.5;
    return {
      targetLeft: { ...this.pointFor('left', t), eye: 'left' },
      targetRight: { ...this.pointFor('right', t), eye: 'right' },
    };
  }

  hud(): HudState {
    return {
      promptKey: this.promptKey,
      promptParams: {
        delta: (
          Math.round(stringDemand(BEAD_T[this.targetBead] ?? 0.5, this.ctx.intensityValue) * 10) / 10
        ).toFixed(1),
      },
      score: this.score,
      roundProgress:
        this.phase === 'look' ? Math.min(1, (this.now - this.phaseSince) / this.lookLimitMs) : null,
    };
  }

  metrics(): Record<string, number> {
    const mean = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 0;
    return {
      beadsShown: this.shown,
      beadsConfirmed: this.confirmed,
      confirmRate: this.shown ? Math.round((this.confirmed / this.shown) * 100) / 100 : 0,
      suppressionReports: this.suppressions,
      meanTimeToCrossMs: Math.round(mean),
      brockNearDemandDelta: this.ctx.intensityValue,
    };
  }

  stop(): void {}
}

/** Good: crossing seen at 3 of 4 beads with at most one suppression report. Poor: under 1 in 3. */
export function assessBrock(metrics: Record<string, number>, _minutes: number): Performance {
  const shown = metrics['beadsShown'] ?? 0;
  if (shown < 4) return 'ok';
  const rate = metrics['confirmRate'] ?? 0;
  if (rate >= 0.75 && (metrics['suppressionReports'] ?? 0) <= 1) return 'good';
  if (rate < 0.33) return 'poor';
  return 'ok';
}

export const brockModule: ModuleDefinition = {
  id: 'brock',
  code: 'B',
  minMinutes: 2,
  maxMinutes: 5,
  defaultMinutes: 3,
  intensity,
  implemented: true,
  requiresInput: true,
  create: (ctx) => new BrockInstance(ctx),
  assess: assessBrock,
};
