import type { ModuleRuntimeContext } from './types';

/** Shared, luminance-only drawing helpers. Layers are drawn white-on-transparent. */

export interface Point {
  x: number;
  y: number;
}

export function stimulusArea(ctx: Pick<ModuleRuntimeContext, 'width' | 'height'>): {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
} {
  // Keep stimuli near primary gaze: central 60% of the canvas.
  return { cx: ctx.width / 2, cy: ctx.height / 2, halfW: ctx.width * 0.3, halfH: ctx.height * 0.3 };
}

export function randomInArea(ctx: ModuleRuntimeContext, margin = 0): Point {
  const a = stimulusArea(ctx);
  const w = Math.max(0, a.halfW - margin);
  const h = Math.max(0, a.halfH - margin);
  return { x: a.cx + (ctx.random() * 2 - 1) * w, y: a.cy + (ctx.random() * 2 - 1) * h };
}

export function clampToArea(
  ctx: Pick<ModuleRuntimeContext, 'width' | 'height'>,
  p: Point,
  margin = 0,
): Point {
  const a = stimulusArea(ctx);
  return {
    x: Math.max(a.cx - a.halfW + margin, Math.min(a.cx + a.halfW - margin, p.x)),
    y: Math.max(a.cy - a.halfH + margin, Math.min(a.cy + a.halfH - margin, p.y)),
  };
}

/** Fusion lock: a thin frame seen by BOTH eyes so the visual system has something to fuse. */
export function drawFusionFrame(
  c: CanvasRenderingContext2D,
  ctx: Pick<ModuleRuntimeContext, 'width' | 'height'>,
  gray = 0.5,
): void {
  const a = stimulusArea(ctx);
  const pad = 24;
  c.strokeStyle = grayCss(gray);
  c.lineWidth = 3;
  c.strokeRect(a.cx - a.halfW - pad, a.cy - a.halfH - pad, (a.halfW + pad) * 2, (a.halfH + pad) * 2);
  // Small central fixation ticks (both eyes).
  c.beginPath();
  c.moveTo(a.cx - 6, a.cy - a.halfH - pad);
  c.lineTo(a.cx + 6, a.cy - a.halfH - pad);
  c.moveTo(a.cx - 6, a.cy + a.halfH + pad);
  c.lineTo(a.cx + 6, a.cy + a.halfH + pad);
  c.stroke();
}

export function grayCss(v: number): string {
  const g = Math.round(255 * Math.max(0, Math.min(1, v)));
  return `rgb(${g},${g},${g})`;
}

export function drawDisc(c: CanvasRenderingContext2D, p: Point, r: number, gray = 1): void {
  c.fillStyle = grayCss(gray);
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fill();
}

export function drawRing(
  c: CanvasRenderingContext2D,
  p: Point,
  r: number,
  lineWidth: number,
  gray = 1,
): void {
  c.strokeStyle = grayCss(gray);
  c.lineWidth = lineWidth;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.stroke();
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Smoothly move `from` toward `to` at `speed` px/s. */
export function glide(from: Point, to: Point, speedPxPerSec: number, dtMs: number): Point {
  const d = distance(from, to);
  const step = (speedPxPerSec * dtMs) / 1000;
  if (d <= step || d === 0) return { ...to };
  return { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step };
}

/**
 * Moves a player-controlled object.
 *  - Held direction (keyboard, gamepad) moves it at a constant speed while held, and stops
 *    the moment the direction is released, so it can be placed precisely.
 *  - A pointer/tap target persists after the pointer is released: the object glides to
 *    the tapped point and stops there. A single click or tap is enough.
 *  - Any held direction cancels a pending target.
 */
export class Steerer {
  private dir: Point = { x: 0, y: 0 };
  private target: Point | null = null;

  constructor(
    public pos: Point,
    private readonly speedPxPerSec: number,
    private readonly margin: number,
  ) {}

  get hasTarget(): boolean {
    return this.target !== null;
  }

  get isMoving(): boolean {
    return this.target !== null || this.dir.x !== 0 || this.dir.y !== 0;
  }

  setDirection(dx: number, dy: number): void {
    const x = Math.max(-1, Math.min(1, Number.isFinite(dx) ? dx : 0));
    const y = Math.max(-1, Math.min(1, Number.isFinite(dy) ? dy : 0));
    this.dir = { x, y };
    if (x !== 0 || y !== 0) this.target = null;
  }

  setTarget(ctx: Pick<ModuleRuntimeContext, 'width' | 'height'>, p: Point): void {
    this.target = clampToArea(ctx, p, this.margin);
  }

  clear(): void {
    this.dir = { x: 0, y: 0 };
    this.target = null;
  }

  update(ctx: Pick<ModuleRuntimeContext, 'width' | 'height'>, dtMs: number): void {
    const { x, y } = this.dir;
    if (x !== 0 || y !== 0) {
      // Diagonals are not faster than straight moves.
      const mag = Math.max(1, Math.hypot(x, y));
      const step = (this.speedPxPerSec * dtMs) / 1000;
      this.pos = { x: this.pos.x + (x / mag) * step, y: this.pos.y + (y / mag) * step };
    } else if (this.target) {
      this.pos = glide(this.pos, this.target, this.speedPxPerSec * 1.6, dtMs);
      if (distance(this.pos, this.target) < 0.01) this.target = null;
    }
    this.pos = clampToArea(ctx, this.pos, this.margin);
  }
}

/** Draw a progress arc (0..1) around a point, starting at 12 o'clock. Changes gradually. */
export function drawProgressArc(
  c: CanvasRenderingContext2D,
  p: Point,
  r: number,
  progress: number,
  lineWidth = 5,
  gray = 1,
): void {
  const f = Math.max(0, Math.min(1, progress));
  if (f <= 0) return;
  c.strokeStyle = grayCss(gray);
  c.lineWidth = lineWidth;
  c.beginPath();
  c.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
  c.stroke();
}

/** Deterministic PRNG for tests (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
