import type { CalibrationProfile, IntensityTier } from '../../data/schema';
import { scaleTransform } from '../../engine/affine';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { pxToPrismDiopters } from '../../engine/units';
import {
  Steerer,
  clampToArea,
  distance,
  drawDisc,
  drawFusionFrame,
  drawProgressArc,
  drawRing,
  glide,
  randomInArea,
  type Point,
} from '../common';
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
 * L2 "Line Them Up" — flat (second-degree) fusion.
 * Right eye sees a RING, left eye sees a BALL; both see the fusion frame. Put the ball in
 * the ring and hold it there until the progress arc completes. Then the ring glides on.
 *
 * Two ways to complete a round:
 *  1. Automatic: the ball's (prism-compensated) position is inside the ring for the hold
 *     time. A progress arc fills around the ring, so the user always sees a reaction.
 *  2. Perceptual: the virtual prism is calibrated, but an incomitant deviation varies with
 *     gaze, so what LOOKS aligned can differ a little from the calibrated position. If the
 *     ball looks inside the ring, the user presses Space. This counts when the ball is
 *     within CONFIRM_RADIUS_FACTOR ring radii, and the residual offset is recorded as a
 *     metric for the clinician.
 *
 * Visual difficulty = percentage of the virtual-prism compensation REMOVED (0% = full
 * compensation from calibration). Any value above 0% needs clinician agreement.
 * Game difficulty = ring size, glide speed, hold time.
 */

export const BALL_RADIUS_FACTOR = 0.42;
/** Perceptual confirmation accepted within this many ring radii of the ring centre. */
export const CONFIRM_RADIUS_FACTOR = 2;
/** Steering speed in CSS px per second. */
export const L2_STEER_SPEED = 180;

const intensity: IntensityMap = {
  metric: 'offsetRemovedPercent',
  unit: '%',
  valueForTier(tier: IntensityTier, _calibration: CalibrationProfile): number {
    if (tier === 'low') return 0;
    if (tier === 'medium') return 10;
    return 20;
  },
  bounds: () => ({ min: 0, max: 50 }),
  maxStepPerSession: 5,
  stepBack: 10,
  harderDirection: 1,
  requiresClinician: true,
  format: (v) => `${Math.round(v)}%`,
};

export class L2Instance implements ModuleInstance {
  private readonly ball: Steerer;
  private ring: Point;
  private ringTarget: Point;
  private readonly ringRadius: number;
  private readonly ballRadius: number;
  private readonly glideSpeed: number;
  private readonly holdRequiredMs: number;
  private holdMs = 0;
  private autoAlignments = 0;
  private confirmedAlignments = 0;
  private farConfirms = 0;
  private residuals: Point[] = [];
  private roundStartedAt = 0;
  private alignTimes: number[] = [];
  private score = 0;
  private promptKey = 'modules.l2.prompt.align';
  private relocating = false;
  private nowMs = 0;
  private farConfirmUntil = 0;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.ringRadius = Math.max(24, 44 - (g - 1) * 5);
    this.ballRadius = this.ringRadius * BALL_RADIUS_FACTOR;
    this.glideSpeed = ctx.reducedMotion ? 60 : 90 + (g - 1) * 30;
    this.holdRequiredMs = 800 + (g - 1) * 200;
    this.ball = new Steerer({ x: ctx.width / 2, y: ctx.height / 2 + 60 }, L2_STEER_SPEED, 12);
    this.ring = { x: ctx.width / 2, y: ctx.height / 2 };
    this.ringTarget = { ...this.ring };
  }

  /** Ball counts as inside when it sits within the ring, with a few px of slack. */
  get alignTolerancePx(): number {
    return this.ringRadius - this.ballRadius + 4;
  }

  get ringPosition(): Point {
    return { ...this.ring };
  }

  get ballPosition(): Point {
    return { ...this.ball.pos };
  }

  start(nowMs: number): void {
    this.roundStartedAt = nowMs;
    this.nowMs = nowMs;
  }

  update(dtMs: number, nowMs: number): void {
    this.nowMs = nowMs;
    if (this.relocating) {
      this.ring = glide(this.ring, this.ringTarget, this.glideSpeed, dtMs);
      if (distance(this.ring, this.ringTarget) < 0.5) {
        this.relocating = false;
        this.roundStartedAt = nowMs;
      }
    }
    this.ball.update(this.ctx, dtMs);

    const aligned = !this.relocating && distance(this.ball.pos, this.ring) <= this.alignTolerancePx;
    if (aligned) {
      this.holdMs += dtMs;
      this.promptKey = 'modules.l2.prompt.hold';
      if (this.holdMs >= this.holdRequiredMs) {
        this.autoAlignments += 1;
        this.completeRound(nowMs);
      }
    } else {
      this.holdMs = Math.max(0, this.holdMs - dtMs * 2);
      this.promptKey =
        nowMs < this.farConfirmUntil
          ? this.farConfirms >= 3
            ? 'modules.l2.prompt.tooFarRecalibrate'
            : 'modules.l2.prompt.tooFar'
          : this.relocating
            ? 'modules.l2.prompt.next'
            : 'modules.l2.prompt.align';
    }
  }

  private completeRound(nowMs: number): void {
    this.alignTimes.push(nowMs - this.roundStartedAt);
    this.score += 10;
    this.holdMs = 0;
    this.ringTarget = randomInArea(this.ctx, this.ringRadius + 10);
    this.relocating = true;
  }

  get alignments(): number {
    return this.autoAlignments + this.confirmedAlignments;
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);
    // LEFT eye: ball.
    drawDisc(l, this.ball.pos, this.ballRadius, 1);
    // RIGHT eye: ring with 4 ticks; slightly thicker while the ball is inside.
    const inside = !this.relocating && distance(this.ball.pos, this.ring) <= this.alignTolerancePx;
    drawRing(r, this.ring, this.ringRadius, inside ? 7 : 5, 1);
    r.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      r.moveTo(this.ring.x + dx * (this.ringRadius + 4), this.ring.y + dy * (this.ringRadius + 4));
      r.lineTo(this.ring.x + dx * (this.ringRadius + 14), this.ring.y + dy * (this.ringRadius + 14));
    }
    r.stroke();
    // Hold progress: a gradually filling arc outside the ring (no flashing).
    if (!this.relocating) {
      drawProgressArc(r, this.ring, this.ringRadius + 22, this.holdMs / this.holdRequiredMs, 6, 0.85);
    }
  }

  input(input: ModuleInput): void {
    if (input.type === 'direction') {
      this.ball.setDirection(input.dx, input.dy);
    } else if (input.type === 'pointer') {
      if (input.down) this.ball.setTarget(this.ctx, { x: input.x, y: input.y });
    } else if (input.type === 'action') {
      this.confirmPerceived();
    }
  }

  /** User reports that the ball LOOKS inside the ring. */
  private confirmPerceived(): void {
    if (this.relocating) return;
    const d = distance(this.ball.pos, this.ring);
    if (d <= this.ringRadius * CONFIRM_RADIUS_FACTOR) {
      this.confirmedAlignments += 1;
      this.residuals.push({ x: this.ball.pos.x - this.ring.x, y: this.ball.pos.y - this.ring.y });
      this.ball.clear();
      this.completeRound(this.nowMs);
    } else {
      this.farConfirms += 1;
      this.farConfirmUntil = this.nowMs + 2000;
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.ball.pos = clampToArea(this.ctx, this.ball.pos, 12);
    this.ring = clampToArea(this.ctx, this.ring, this.ringRadius);
    this.ringTarget = clampToArea(this.ctx, this.ringTarget, this.ringRadius);
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    // Remove a percentage of the calibrated compensation: scale both transforms.
    const keep = 1 - Math.max(0, Math.min(50, this.ctx.intensityValue)) / 100;
    return {
      ...base,
      transforms: {
        left: scaleTransform(base.transforms.left, keep),
        right: scaleTransform(base.transforms.right, keep),
      },
    };
  }

  probe(): Record<string, ProbePoint> {
    return {
      ring: { ...this.ring, eye: 'right' },
      ball: { ...this.ball.pos, eye: 'left' },
    };
  }

  hud(): HudState {
    return {
      promptKey: this.promptKey,
      score: this.score,
      roundProgress: this.relocating ? null : Math.min(1, this.holdMs / this.holdRequiredMs),
    };
  }

  metrics(): Record<string, number> {
    const mean = this.alignTimes.length
      ? this.alignTimes.reduce((a, b) => a + b, 0) / this.alignTimes.length
      : 0;
    const out: Record<string, number> = {
      alignments: this.alignments,
      autoAlignments: this.autoAlignments,
      confirmedAlignments: this.confirmedAlignments,
      farConfirms: this.farConfirms,
      meanTimeToAlignMs: Math.round(mean),
      score: this.score,
    };
    if (this.residuals.length) {
      const n = this.residuals.length;
      const dx = this.residuals.reduce((a, r) => a + r.x, 0) / n;
      const dy = this.residuals.reduce((a, r) => a + r.y, 0) / n;
      out['meanResidualDxPx'] = Math.round(dx * 10) / 10;
      out['meanResidualDyPx'] = Math.round(dy * 10) / 10;
      out['meanResidualDelta'] =
        Math.round(pxToPrismDiopters(Math.hypot(dx, dy), this.ctx.geometry) * 100) / 100;
    }
    return out;
  }

  stop(): void {
    this.ball.clear();
  }
}

/** Good: at least 2 completed alignments per minute. Poor: none at all. */
export function assessL2(metrics: Record<string, number>, minutes: number): Performance {
  const n = metrics['alignments'] ?? 0;
  if (n === 0) return 'poor';
  if (minutes > 0 && n / minutes >= 2) return 'good';
  return 'ok';
}

export const l2Module: ModuleDefinition = {
  id: 'l2',
  code: 'L2',
  minMinutes: 3,
  maxMinutes: 5,
  defaultMinutes: 4,
  intensity,
  implemented: true,
  requiresInput: true,
  create: (ctx) => new L2Instance(ctx),
  assess: assessL2,
};
