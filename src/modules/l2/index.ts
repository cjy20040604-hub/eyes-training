import type { CalibrationProfile, IntensityTier } from '../../data/schema';
import { scaleTransform } from '../../engine/affine';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import {
  clampToArea,
  distance,
  drawDisc,
  drawFusionFrame,
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
} from '../types';

/**
 * L2 "Line Them Up" — flat (second-degree) fusion.
 * Right eye sees a RING, left eye sees a BALL; both see the fusion frame. Put the ball in
 * the ring and hold it for a moment. Then the ring glides to a new spot.
 *
 * Visual difficulty = percentage of the virtual-prism compensation REMOVED (0% = full
 * compensation from calibration). Any value above 0% needs clinician agreement.
 * Game difficulty = ring size, glide speed, hold time.
 */

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

class L2Instance implements ModuleInstance {
  private ball: Point;
  private ring: Point;
  private ringTarget: Point;
  private ringRadius: number;
  private glideSpeed: number;
  private holdRequiredMs: number;
  private holdMs = 0;
  private alignments = 0;
  private roundStartedAt = 0;
  private alignTimes: number[] = [];
  private score = 0;
  private moveVel: Point = { x: 0, y: 0 };
  private pointerTarget: Point | null = null;
  private promptKey = 'modules.l2.prompt.align';
  private relocating = false;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.ringRadius = Math.max(22, 44 - (g - 1) * 5);
    this.glideSpeed = ctx.reducedMotion ? 60 : 90 + (g - 1) * 30;
    this.holdRequiredMs = 800 + (g - 1) * 200;
    this.ball = { x: ctx.width / 2, y: ctx.height / 2 + 60 };
    this.ring = { x: ctx.width / 2, y: ctx.height / 2 };
    this.ringTarget = { ...this.ring };
  }

  start(nowMs: number): void {
    this.roundStartedAt = nowMs;
  }

  update(dtMs: number, nowMs: number): void {
    if (this.relocating) {
      this.ring = glide(this.ring, this.ringTarget, this.glideSpeed, dtMs);
      if (distance(this.ring, this.ringTarget) < 0.5) {
        this.relocating = false;
        this.roundStartedAt = nowMs;
      }
    }
    if (this.pointerTarget) {
      this.ball = glide(this.ball, this.pointerTarget, 320, dtMs);
    } else {
      this.ball = clampToArea(
        this.ctx,
        { x: this.ball.x + (this.moveVel.x * dtMs) / 1000, y: this.ball.y + (this.moveVel.y * dtMs) / 1000 },
        12,
      );
    }
    this.moveVel = { x: this.moveVel.x * 0.85, y: this.moveVel.y * 0.85 };

    const aligned = !this.relocating && distance(this.ball, this.ring) < this.ringRadius * 0.4;
    if (aligned) {
      this.holdMs += dtMs;
      this.promptKey = 'modules.l2.prompt.hold';
      if (this.holdMs >= this.holdRequiredMs) {
        this.alignments += 1;
        this.alignTimes.push(nowMs - this.roundStartedAt);
        this.score += 10;
        this.holdMs = 0;
        this.ringTarget = randomInArea(this.ctx, this.ringRadius + 10);
        this.relocating = true;
      }
    } else {
      this.holdMs = Math.max(0, this.holdMs - dtMs * 2);
      this.promptKey = 'modules.l2.prompt.align';
    }
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);
    // LEFT eye: ball
    drawDisc(l, this.ball, this.ringRadius * 0.55, 1);
    // RIGHT eye: ring with 4 ticks
    drawRing(r, this.ring, this.ringRadius, 5, 1);
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
  }

  input(input: ModuleInput): void {
    if (input.type === 'move') {
      this.pointerTarget = null;
      this.moveVel = { x: this.moveVel.x + input.dx * 180, y: this.moveVel.y + input.dy * 180 };
    } else if (input.type === 'pointer') {
      this.pointerTarget = input.down ? clampToArea(this.ctx, { x: input.x, y: input.y }, 12) : null;
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.ball = clampToArea(this.ctx, this.ball, 12);
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
    return { alignments: this.alignments, meanTimeToAlignMs: Math.round(mean), score: this.score };
  }

  stop(): void {
    this.pointerTarget = null;
  }
}

export const l2Module: ModuleDefinition = {
  id: 'l2',
  code: 'L2',
  minMinutes: 3,
  maxMinutes: 5,
  defaultMinutes: 4,
  intensity,
  implemented: true,
  create: (ctx) => new L2Instance(ctx),
};
