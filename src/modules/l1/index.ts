import type { CalibrationProfile, IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import {
  Steerer,
  clampToArea,
  distance,
  drawDisc,
  drawFusionFrame,
  glide,
  grayCss,
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
 * L1 "Both Eyes On" — simultaneous perception.
 * Left (suppressed) eye sees the BIRD. Right eye sees the CAGE. Both see a fusion frame.
 * The user steers the bird into the cage (arrow keys / WASD hold to move, or click/tap
 * where it should go); the cage drifts gently. A small "chick" appears under the bird
 * (LEFT eye only) at random intervals; pressing Space while it is visible records a probe
 * hit (evidence the left eye is contributing). Presses with no chick are false alarms.
 *
 * Visual difficulty = dominant (right) eye contrast ratio; the left eye is always 100%.
 * Game difficulty = cage size / drift speed.
 */

export const L1_STEER_SPEED = 200;

const intensity: IntensityMap = {
  metric: 'dominantContrastRatio',
  unit: '',
  valueForTier(tier: IntensityTier, calibration: CalibrationProfile): number {
    const b = calibration.contrastBalance.balanceRatio;
    if (tier === 'low') return round2(b);
    if (tier === 'medium') return round2(b + (1 - b) * 0.25);
    return round2(b + (1 - b) * 0.5);
  },
  bounds: (calibration) => ({
    min: 0.05,
    max: Math.min(1, calibration.contrastBalance.balanceRatio + 0.6),
  }),
  maxStepPerSession: 0.05,
  stepBack: 0.1,
  harderDirection: 1,
  requiresClinician: false,
  format: (v) => `${Math.round(v * 100)}%`,
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export class L1Instance implements ModuleInstance {
  private readonly bird: Steerer;
  private cage: Point;
  private cageTarget: Point;
  private readonly cageHalf: number;
  private readonly driftSpeed: number;
  private nextRelocateAt = 0;
  private timeInCageMs = 0;
  private elapsedMs = 0;
  private score = 0;
  private probeVisible = false;
  private probeShownAt = 0;
  private nextProbeAt = 0;
  private probesShown = 0;
  private probesHit = 0;
  private falseAlarms = 0;
  private probeHitThisWindow = false;
  private promptKey = 'modules.l1.prompt.steer';
  private inside = false;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.cageHalf = Math.max(28, 70 - (g - 1) * 8);
    this.driftSpeed = ctx.reducedMotion ? 10 : 15 + (g - 1) * 10;
    this.bird = new Steerer({ x: ctx.width / 2 - 120, y: ctx.height / 2 }, L1_STEER_SPEED, 16);
    this.cage = { x: ctx.width / 2, y: ctx.height / 2 };
    this.cageTarget = { ...this.cage };
  }

  get cagePosition(): Point {
    return { ...this.cage };
  }

  get birdPosition(): Point {
    return { ...this.bird.pos };
  }

  get isProbeVisible(): boolean {
    return this.probeVisible;
  }

  start(nowMs: number): void {
    this.nextRelocateAt = nowMs + 4000;
    this.nextProbeAt = nowMs + 8000 + this.ctx.random() * 8000;
  }

  update(dtMs: number, nowMs: number): void {
    this.elapsedMs += dtMs;
    // Cage relocation (gentle glide; no abrupt luminance change).
    if (nowMs >= this.nextRelocateAt) {
      this.cageTarget = randomInArea(this.ctx, this.cageHalf + 10);
      const interval = this.ctx.reducedMotion ? 8000 : 6000 - (this.ctx.gameDifficulty - 1) * 600;
      this.nextRelocateAt = nowMs + interval;
    }
    this.cage = glide(this.cage, this.cageTarget, this.driftSpeed, dtMs);
    this.bird.update(this.ctx, dtMs);

    this.inside =
      Math.abs(this.bird.pos.x - this.cage.x) < this.cageHalf - 10 &&
      Math.abs(this.bird.pos.y - this.cage.y) < this.cageHalf - 10;
    if (this.inside) {
      this.timeInCageMs += dtMs;
      this.score += dtMs / 1000;
    }
    this.promptKey = this.probeVisible
      ? 'modules.l1.prompt.chick'
      : this.inside
        ? 'modules.l1.prompt.hold'
        : 'modules.l1.prompt.steer';

    // Probe marker (left eye only). Guarded so it can never flicker.
    if (!this.probeVisible && nowMs >= this.nextProbeAt) {
      if (this.ctx.guard.request(nowMs, 'l1-probe')) {
        this.probeVisible = true;
        this.probeShownAt = nowMs;
        this.probesShown += 1;
        this.probeHitThisWindow = false;
        this.ctx.emit('probe', { shown: this.probesShown });
      }
    }
    if (this.probeVisible && nowMs - this.probeShownAt > 2500) {
      if (this.ctx.guard.request(nowMs, 'l1-probe')) {
        this.probeVisible = false;
        this.nextProbeAt = nowMs + 10000 + this.ctx.random() * 10000;
      }
    }
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);

    // LEFT eye: bird = disc + wing + beak.
    const b = this.bird.pos;
    drawDisc(l, b, 14, 1);
    l.fillStyle = grayCss(1);
    l.beginPath();
    l.moveTo(b.x - 6, b.y - 2);
    l.lineTo(b.x - 26, b.y - 14);
    l.lineTo(b.x - 10, b.y + 8);
    l.closePath();
    l.fill();
    l.beginPath();
    l.moveTo(b.x + 14, b.y - 3);
    l.lineTo(b.x + 24, b.y);
    l.lineTo(b.x + 14, b.y + 3);
    l.closePath();
    l.fill();
    if (this.probeVisible) {
      drawDisc(l, { x: b.x, y: b.y + 26 }, 5, 0.9);
    }

    // RIGHT eye: cage = bars. Bars get thicker while the bird is inside (gradual cue).
    r.strokeStyle = grayCss(1);
    r.lineWidth = this.inside ? 6 : 4;
    const h = this.cageHalf;
    r.strokeRect(this.cage.x - h, this.cage.y - h, h * 2, h * 2);
    r.beginPath();
    for (let i = 1; i < 5; i++) {
      const x = this.cage.x - h + (i * 2 * h) / 5;
      r.moveTo(x, this.cage.y - h);
      r.lineTo(x, this.cage.y + h);
    }
    r.stroke();
    r.lineWidth = 6;
    r.beginPath();
    r.arc(this.cage.x, this.cage.y - h - 10, 8, Math.PI, 0);
    r.stroke();
  }

  input(input: ModuleInput): void {
    if (input.type === 'direction') {
      this.bird.setDirection(input.dx, input.dy);
    } else if (input.type === 'pointer') {
      if (input.down) this.bird.setTarget(this.ctx, { x: input.x, y: input.y });
    } else if (input.type === 'action') {
      if (this.probeVisible && !this.probeHitThisWindow) {
        this.probeHitThisWindow = true;
        this.probesHit += 1;
        this.score += 5;
      } else if (!this.probeVisible) {
        this.falseAlarms += 1;
      }
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.bird.pos = clampToArea(this.ctx, this.bird.pos, 16);
    this.cage = clampToArea(this.ctx, this.cage, this.cageHalf);
    this.cageTarget = clampToArea(this.ctx, this.cageTarget, this.cageHalf);
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    const dominant = this.ctx.calibration.contrastBalance.dominantEye;
    const weak = dominant === 'right' ? 'left' : 'right';
    return {
      ...base,
      contrast: { ...base.contrast, [dominant]: this.ctx.intensityValue, [weak]: 1 },
    };
  }

  probe(): Record<string, ProbePoint> {
    return {
      cage: { ...this.cage, eye: 'right' },
      bird: { ...this.bird.pos, eye: 'left' },
    };
  }

  hud(): HudState {
    return { promptKey: this.promptKey, score: Math.round(this.score), roundProgress: null };
  }

  metrics(): Record<string, number> {
    return {
      timeInCageFraction:
        this.elapsedMs > 0 ? Math.round((this.timeInCageMs / this.elapsedMs) * 1000) / 1000 : 0,
      probesShown: this.probesShown,
      probesHit: this.probesHit,
      probeHitRate: this.probesShown > 0 ? Math.round((this.probesHit / this.probesShown) * 1000) / 1000 : 0,
      probeFalseAlarms: this.falseAlarms,
      score: Math.round(this.score),
      birdToCageFinalPx: Math.round(distance(this.bird.pos, this.cage)),
    };
  }

  stop(): void {
    this.bird.clear();
  }
}

/**
 * Good: bird in the cage at least half the time and, when chicks appeared, at least half
 * noticed. Poor: bird in the cage less than 15% of the time.
 */
export function assessL1(metrics: Record<string, number>, _minutes: number): Performance {
  const inCage = metrics['timeInCageFraction'] ?? 0;
  const shown = metrics['probesShown'] ?? 0;
  const hitRate = metrics['probeHitRate'] ?? 0;
  if (inCage < 0.15) return 'poor';
  const probesOk = shown < 2 || hitRate >= 0.5;
  if (inCage >= 0.5 && probesOk) return 'good';
  return 'ok';
}

export const l1Module: ModuleDefinition = {
  id: 'l1',
  code: 'L1',
  minMinutes: 2,
  maxMinutes: 4,
  defaultMinutes: 3,
  intensity,
  implemented: true,
  requiresInput: true,
  create: (ctx) => new L1Instance(ctx),
  assess: assessL1,
};
