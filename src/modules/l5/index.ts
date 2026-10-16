import type { IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { generateRds, snapDisparity, type RdsImage, type Rect } from '../../engine/rds';
import {
  createStaircase,
  staircaseRespond,
  staircaseThreshold,
  type StaircaseConfig,
  type StaircaseState,
} from '../../engine/staircase';
import { arcsecToPx, pxToArcsec } from '../../engine/units';
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
 * L5 "Pop-Out" — random-dot stereopsis with an adaptive staircase.
 *
 * Each trial shows a Julesz random-dot stereogram (no monocular cue). A square hidden in
 * the dots floats in front of the field in one of four positions: up, down, left or right.
 * The user answers with the arrow keys (or by tapping that side); Space means "I can't
 * tell", which is a valid answer and simply counts as not seen. A 2-down / 1-up staircase
 * on disparity (in arcseconds) finds the smallest depth difference the user can see.
 * Not seeing depth is a normal, informative result, not a failure.
 *
 * Visual difficulty = the starting disparity (smaller is harder).
 * Game difficulty = presentation time (level 1 waits for the answer).
 */

export type Side = 'up' | 'down' | 'left' | 'right';
const SIDES: Side[] = ['up', 'down', 'left', 'right'];

const intensity: IntensityMap = {
  metric: 'stereoDisparityArcsec',
  unit: '″',
  valueForTier: (tier: IntensityTier) => (tier === 'low' ? 800 : tier === 'medium' ? 400 : 200),
  bounds: () => ({ min: 40, max: 1600 }),
  maxStepPerSession: 100,
  stepBack: 200,
  harderDirection: -1,
  requiresClinician: false,
  format: (v) => `${Math.round(v)}″`,
};

type Phase = 'show' | 'feedback' | 'gap';

export class L5Instance implements ModuleInstance {
  private readonly cfg: StaircaseConfig;
  private stair: StaircaseState;
  private phase: Phase = 'gap';
  private phaseUntil = 0;
  private image: RdsImage | null = null;
  private side: Side = 'up';
  private lastCorrect: boolean | null = null;
  private trials = 0;
  private correct = 0;
  private cantTell = 0;
  private bestCorrectArcsec = Infinity;
  private readonly showMs: number;
  private now = 0;
  private score = 0;
  private shownArcsec = 0;

  constructor(private ctx: ModuleRuntimeContext) {
    const minArcsec = Math.max(40, pxToArcsec(1 / Math.max(1, ctx.dpr), ctx.geometry));
    this.cfg = {
      start: Math.max(minArcsec, ctx.intensityValue),
      min: minArcsec,
      max: 1600,
      step: 1.4,
      up: 2,
      down: 1,
      harderDirection: -1,
      maxReversals: 10,
      logarithmic: true,
    };
    this.stair = createStaircase(this.cfg);
    const g = ctx.gameDifficulty;
    this.showMs = g <= 1 ? Infinity : ([4000, 3000, 2000, 1500][g - 2] ?? 1500);
  }

  get currentSide(): Side {
    return this.side;
  }

  get isShowing(): boolean {
    return this.phase === 'show';
  }

  get currentArcsec(): number {
    return this.shownArcsec;
  }

  start(nowMs: number): void {
    this.now = nowMs;
    this.phase = 'gap';
    this.phaseUntil = nowMs + 600;
  }

  private field(): Rect {
    const a = stimulusArea(this.ctx);
    const size = Math.round(Math.min(a.halfW, a.halfH) * 2);
    return { x: Math.round(a.cx - size / 2), y: Math.round(a.cy - size / 2), w: size, h: size };
  }

  private newTrial(): void {
    const f = this.field();
    const t = Math.round(f.w * 0.26);
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const off = f.w * 0.24;
    this.side = SIDES[Math.floor(this.ctx.random() * 4)] ?? 'up';
    const center =
      this.side === 'up'
        ? { x: cx, y: cy - off }
        : this.side === 'down'
          ? { x: cx, y: cy + off }
          : this.side === 'left'
            ? { x: cx - off, y: cy }
            : { x: cx + off, y: cy };
    const target: Rect = { x: center.x - t / 2, y: center.y - t / 2, w: t, h: t };
    const disparity = snapDisparity(arcsecToPx(this.stair.value, this.ctx.geometry), this.ctx.dpr);
    this.shownArcsec = Math.round(pxToArcsec(disparity, this.ctx.geometry));
    this.image = generateRds({
      field: f,
      target,
      dotSize: 4,
      density: 0.45,
      disparityPx: disparity,
      random: this.ctx.random,
    });
  }

  update(_dtMs: number, nowMs: number): void {
    this.now = nowMs;
    if (nowMs < this.phaseUntil) return;
    if (this.phase === 'gap') {
      // A new random pattern is a large-area change: let the transition guard space it out.
      if (!this.ctx.guard.request(nowMs, 'l5-trial')) return;
      this.newTrial();
      this.phase = 'show';
      this.phaseUntil = Number.isFinite(this.showMs) ? nowMs + this.showMs : Infinity;
    } else if (this.phase === 'show') {
      // Time ran out: treat as "can't tell".
      this.answer(null);
    } else if (this.phase === 'feedback') {
      this.phase = 'gap';
      this.phaseUntil = nowMs + 500;
    }
  }

  /** null = "I can't tell". */
  private answer(side: Side | null): void {
    if (this.phase !== 'show') return;
    const ok = side === this.side;
    this.trials += 1;
    if (ok) {
      this.correct += 1;
      this.score += 10;
      this.bestCorrectArcsec = Math.min(this.bestCorrectArcsec, this.shownArcsec);
    }
    if (side === null) this.cantTell += 1;
    this.lastCorrect = ok;
    this.stair = staircaseRespond(this.stair, ok, this.cfg);
    this.phase = 'feedback';
    this.phaseUntil = this.now + 700;
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    drawFusionFrame(l, this.ctx);
    drawFusionFrame(r, this.ctx);
    const f = this.field();
    if (this.image && this.phase !== 'gap') {
      const s = this.image.dotSize;
      l.fillStyle = grayCss(1);
      for (const p of this.image.left) l.fillRect(p.x, p.y, s, s);
      r.fillStyle = grayCss(1);
      for (const p of this.image.right) r.fillRect(p.x, p.y, s, s);
    }
    if (this.phase === 'feedback' && this.lastCorrect !== null) {
      // Feedback is a thin outline around the field, seen by both eyes (no flashing fill).
      for (const c of [l, r]) {
        c.strokeStyle = grayCss(this.lastCorrect ? 1 : 0.45);
        c.lineWidth = this.lastCorrect ? 4 : 2;
        c.setLineDash(this.lastCorrect ? [] : [8, 8]);
        c.strokeRect(f.x - 10, f.y - 10, f.w + 20, f.h + 20);
        c.setLineDash([]);
      }
    }
  }

  input(input: ModuleInput): void {
    if (this.phase !== 'show') return;
    if (input.type === 'action') {
      this.answer(null);
    } else if (input.type === 'direction') {
      if (input.dx === 0 && input.dy === 0) return;
      if (Math.abs(input.dx) >= Math.abs(input.dy)) this.answer(input.dx > 0 ? 'right' : 'left');
      else this.answer(input.dy > 0 ? 'down' : 'up');
    } else if (input.type === 'pointer' && input.down) {
      const a = stimulusArea(this.ctx);
      const dx = input.x - a.cx;
      const dy = input.y - a.cy;
      if (Math.abs(dx) >= Math.abs(dy)) this.answer(dx > 0 ? 'right' : 'left');
      else this.answer(dy > 0 ? 'down' : 'up');
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.image = null;
    if (this.phase === 'show') {
      this.phase = 'gap';
      this.phaseUntil = this.now + 300;
    }
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    return base;
  }

  hud(): HudState {
    return {
      promptKey:
        this.phase === 'show'
          ? 'modules.l5.prompt.where'
          : this.phase === 'feedback'
            ? this.lastCorrect
              ? 'modules.l5.prompt.right'
              : 'modules.l5.prompt.notSeen'
            : 'modules.l5.prompt.next',
      score: this.score,
      roundProgress: null,
    };
  }

  metrics(): Record<string, number> {
    const threshold = staircaseThreshold(this.stair, 4);
    const out: Record<string, number> = {
      trials: this.trials,
      correctTrials: this.correct,
      cantTell: this.cantTell,
      percentCorrect: this.trials ? Math.round((this.correct / this.trials) * 100) : 0,
      reversals: this.stair.reversals.length,
      score: this.score,
    };
    if (threshold !== null) out['stereoThresholdArcsec'] = Math.round(threshold);
    if (Number.isFinite(this.bestCorrectArcsec)) out['bestSeenArcsec'] = Math.round(this.bestCorrectArcsec);
    return out;
  }

  stop(): void {}
}

/**
 * Good: at least 10 trials with at least 70% correct (stereo is being used reliably).
 * Poor: fewer than 40% correct with enough trials (step back to larger disparities).
 */
export function assessL5(metrics: Record<string, number>, _minutes: number): Performance {
  const trials = metrics['trials'] ?? 0;
  const pct = metrics['percentCorrect'] ?? 0;
  if (trials < 10) return 'ok';
  if (pct >= 70) return 'good';
  if (pct < 40) return 'poor';
  return 'ok';
}

export const l5Module: ModuleDefinition = {
  id: 'l5',
  code: 'L5',
  minMinutes: 3,
  maxMinutes: 5,
  defaultMinutes: 3,
  intensity,
  implemented: true,
  requiresInput: true,
  vrReady: true,
  create: (ctx) => new L5Instance(ctx),
  assess: assessL5,
};
