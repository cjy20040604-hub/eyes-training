import type { CalibrationProfile, IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { Steerer, drawDisc, drawFusionFrame, grayCss, stimulusArea, type Point } from '../common';
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
 * L3 "Don't Lose the Left" — anti-suppression catch.
 *
 * The weak (left) eye gets the main task: STARS fall that only the left eye can see.
 * The dominant (right) eye sees the BASKET the user steers, so catching a star needs both
 * eyes at once: the left eye to see the star and the right eye to place the basket.
 * From game level 2, CLOUDS fall that only the right eye sees; catching one breaks the
 * streak. Both eyes see the fusion frame.
 *
 * Visual difficulty = dominant (right) eye contrast, as in L1. The left eye stays at 100%.
 * Game difficulty = fall speed, star size, spawn rate, basket width, clouds.
 */

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

interface Faller {
  kind: 'star' | 'cloud';
  p: Point;
  r: number;
  vy: number;
}

export class L3Instance implements ModuleInstance {
  private readonly basket: Steerer;
  private readonly basketHalf: number;
  private readonly fallSpeed: number;
  private readonly starRadius: number;
  private readonly spawnEveryMs: number;
  private readonly clouds: boolean;
  private fallers: Faller[] = [];
  private nextSpawnAt = 0;
  private caught = 0;
  private missed = 0;
  private cloudsHit = 0;
  private streak = 0;
  private bestStreak = 0;
  private score = 0;
  private promptKey = 'modules.l3.prompt.catch';
  private flashUntil = 0;
  private now = 0;

  constructor(private ctx: ModuleRuntimeContext) {
    const g = ctx.gameDifficulty;
    this.basketHalf = Math.max(42, 74 - (g - 1) * 8);
    this.fallSpeed = (ctx.reducedMotion ? 45 : 60) + (g - 1) * 22;
    this.starRadius = Math.max(8, 15 - (g - 1) * 1.6);
    this.spawnEveryMs = Math.max(900, 1700 - (g - 1) * 200);
    this.clouds = g >= 2;
    const a = stimulusArea(ctx);
    this.basket = new Steerer({ x: a.cx, y: this.basketY() }, 260, this.basketHalf);
  }

  private basketY(): number {
    const a = stimulusArea(this.ctx);
    return a.cy + a.halfH - 18;
  }

  get basketPosition(): Point {
    return { ...this.basket.pos };
  }

  get activeFallers(): ReadonlyArray<Faller> {
    return this.fallers;
  }

  start(nowMs: number): void {
    this.now = nowMs;
    this.nextSpawnAt = nowMs + 800;
  }

  private spawn(): void {
    const a = stimulusArea(this.ctx);
    const isCloud = this.clouds && this.ctx.random() < 0.25;
    const r = isCloud ? this.starRadius * 1.6 : this.starRadius;
    const x = a.cx - a.halfW + r + this.ctx.random() * (2 * a.halfW - 2 * r);
    this.fallers.push({
      kind: isCloud ? 'cloud' : 'star',
      p: { x, y: a.cy - a.halfH + r },
      r,
      vy: this.fallSpeed * (0.85 + this.ctx.random() * 0.3),
    });
  }

  update(dtMs: number, nowMs: number): void {
    this.now = nowMs;
    // The basket only moves horizontally, along a fixed line near the bottom.
    this.basket.update(this.ctx, dtMs);
    this.basket.pos = { x: this.basket.pos.x, y: this.basketY() };

    if (nowMs >= this.nextSpawnAt) {
      this.spawn();
      this.nextSpawnAt = nowMs + this.spawnEveryMs * (0.8 + this.ctx.random() * 0.4);
    }

    const by = this.basketY();
    const remaining: Faller[] = [];
    for (const f of this.fallers) {
      f.p = { x: f.p.x, y: f.p.y + (f.vy * dtMs) / 1000 };
      const reachedBasket = f.p.y + f.r >= by - 6;
      if (reachedBasket) {
        const inBasket = Math.abs(f.p.x - this.basket.pos.x) <= this.basketHalf;
        if (f.kind === 'star') {
          if (inBasket) {
            this.caught += 1;
            this.streak += 1;
            this.bestStreak = Math.max(this.bestStreak, this.streak);
            this.score += 10 + Math.min(10, this.streak);
          } else {
            this.missed += 1;
            this.streak = 0;
          }
        } else if (inBasket) {
          this.cloudsHit += 1;
          this.streak = 0;
          this.flashUntil = nowMs + 1500;
        }
        continue;
      }
      remaining.push(f);
    }
    this.fallers = remaining;
    this.promptKey =
      nowMs < this.flashUntil
        ? 'modules.l3.prompt.cloud'
        : this.streak >= 5
          ? 'modules.l3.prompt.streak'
          : 'modules.l3.prompt.catch';
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);

    for (const f of this.fallers) {
      if (f.kind === 'star') {
        // LEFT eye only: a five-point star.
        drawStar(l, f.p, f.r);
      } else {
        // RIGHT eye only: a cloud of three discs.
        drawDisc(r, { x: f.p.x - f.r * 0.6, y: f.p.y + f.r * 0.15 }, f.r * 0.6, 0.85);
        drawDisc(r, { x: f.p.x + f.r * 0.6, y: f.p.y + f.r * 0.15 }, f.r * 0.6, 0.85);
        drawDisc(r, { x: f.p.x, y: f.p.y - f.r * 0.2 }, f.r * 0.75, 0.85);
      }
    }

    // RIGHT eye: the basket.
    const b = this.basket.pos;
    r.strokeStyle = grayCss(1);
    r.lineWidth = 5;
    r.beginPath();
    r.moveTo(b.x - this.basketHalf, b.y - 22);
    r.lineTo(b.x - this.basketHalf + 10, b.y);
    r.lineTo(b.x + this.basketHalf - 10, b.y);
    r.lineTo(b.x + this.basketHalf, b.y - 22);
    r.stroke();
  }

  input(input: ModuleInput): void {
    if (input.type === 'direction') {
      this.basket.setDirection(input.dx, 0);
    } else if (input.type === 'pointer' && input.down) {
      this.basket.setTarget(this.ctx, { x: input.x, y: this.basketY() });
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.basket.pos = { x: this.basket.pos.x, y: this.basketY() };
    this.fallers = [];
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
    const out: Record<string, ProbePoint> = { basket: { ...this.basket.pos, eye: 'right' } };
    // The lowest star still falling: the one to catch next.
    const next = this.fallers
      .filter((f) => f.kind === 'star')
      .reduce<Faller | null>((best, f) => (!best || f.p.y > best.p.y ? f : best), null);
    if (next) out['star'] = { ...next.p, eye: 'left' };
    return out;
  }

  hud(): HudState {
    return {
      promptKey: this.promptKey,
      promptParams: { streak: this.streak },
      score: this.score,
      roundProgress: null,
    };
  }

  metrics(): Record<string, number> {
    const total = this.caught + this.missed;
    return {
      starsCaught: this.caught,
      starsMissed: this.missed,
      catchRate: total ? Math.round((this.caught / total) * 1000) / 1000 : 0,
      cloudsHit: this.cloudsHit,
      bestStreak: this.bestStreak,
      score: this.score,
    };
  }

  stop(): void {
    this.basket.clear();
  }
}

function drawStar(c: CanvasRenderingContext2D, p: Point, r: number): void {
  c.fillStyle = grayCss(1);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = p.x + Math.cos(a) * rad;
    const y = p.y + Math.sin(a) * rad;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
}

/** Good: at least 70% of stars caught (and enough of them). Poor: under 30%. */
export function assessL3(metrics: Record<string, number>, _minutes: number): Performance {
  const caught = metrics['starsCaught'] ?? 0;
  const missed = metrics['starsMissed'] ?? 0;
  const total = caught + missed;
  if (total < 5) return 'ok';
  const rate = caught / total;
  if (rate < 0.3) return 'poor';
  if (rate >= 0.7) return 'good';
  return 'ok';
}

export const l3Module: ModuleDefinition = {
  id: 'l3',
  code: 'L3',
  minMinutes: 3,
  maxMinutes: 5,
  defaultMinutes: 4,
  intensity,
  implemented: true,
  requiresInput: true,
  create: (ctx) => new L3Instance(ctx),
  assess: assessL3,
};
