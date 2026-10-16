import type { Assessment } from '../data/schema';
import { generateRds, snapDisparity, type RdsImage, type Rect } from '../engine/rds';
import {
  createStaircase,
  staircaseRespond,
  staircaseThreshold,
  type StaircaseConfig,
  type StaircaseState,
} from '../engine/staircase';
import { mulberry32 } from '../engine/random';
import { arcsecToPx, pxToArcsec, pxToPrismDiopters, type ScreenGeometry } from '../engine/units';

/**
 * The weekly check: the same short measurement every week, with no feedback and no score,
 * so that a change reflects the eyes rather than practice at a game.
 *  1. Worth 4-dot (how many dots).
 *  2. Perceived alignment, twice: the left image starts a little off; the user centres it.
 *  3. Contrast balance point (the same staircase as calibration).
 *  4. Stereo threshold: random-dot stereograms on a 2-down / 1-up staircase, no feedback.
 * The first two completed checks form the baseline; later checks are compared with it.
 */

export const CHECK_INTERVAL_DAYS = 7;
export const BASELINE_CHECKS = 2;
const DAY_MS = 86_400_000;

export function completedChecks(assessments: Assessment[]): Assessment[] {
  return assessments.filter((a) => a.status === 'completed').sort((a, b) => a.at.localeCompare(b.at));
}

export function daysSinceLastCheck(assessments: Assessment[], now = new Date()): number | null {
  const done = completedChecks(assessments);
  const last = done[done.length - 1];
  if (!last) return null;
  return Math.floor((now.getTime() - new Date(last.at).getTime()) / DAY_MS);
}

/** Due when there has been no check yet, or the last one is a week old. */
export function checkDue(assessments: Assessment[], now = new Date()): boolean {
  const days = daysSinceLastCheck(assessments, now);
  return days === null || days >= CHECK_INTERVAL_DAYS;
}

export function daysUntilNextCheck(assessments: Assessment[], now = new Date()): number {
  const days = daysSinceLastCheck(assessments, now);
  return days === null ? 0 : Math.max(0, CHECK_INTERVAL_DAYS - days);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function summarizeAlignment(
  horizontalPx: number[],
  verticalPx: number[],
  geometry: ScreenGeometry,
): NonNullable<Assessment['alignment']> {
  const toDelta = (px: number) => Math.sign(px) * pxToPrismDiopters(Math.abs(px), geometry);
  const h = horizontalPx.map(toDelta).map((v) => Math.round(v * 100) / 100);
  const v = verticalPx.map(toDelta).map((x) => Math.round(x * 100) / 100);
  const m = mean(h);
  return {
    horizontalDelta: h,
    verticalDelta: v,
    meanDelta: Math.round(m * 100) / 100,
    spreadDelta: h.length > 1 ? Math.round((Math.max(...h) - Math.min(...h)) * 100) / 100 : 0,
  };
}

export interface CheckMeasures {
  alignmentDelta: number | null;
  balancePercent: number | null;
  stereoArcsec: number | null;
  worthDots: number | null;
}

export function measuresOf(a: Assessment): CheckMeasures {
  return {
    alignmentDelta: a.alignment ? a.alignment.meanDelta : null,
    balancePercent: a.balance ? Math.round(a.balance.ratio * 100) : null,
    stereoArcsec: a.stereo?.thresholdArcsec ?? null,
    worthDots: a.worth && !a.worth.alternating ? a.worth.dotsSeen : null,
  };
}

/** Mean of the first BASELINE_CHECKS completed checks, per measure (null until available). */
export function baseline(assessments: Assessment[]): (CheckMeasures & { checks: number }) | null {
  const first = completedChecks(assessments).slice(0, BASELINE_CHECKS);
  if (first.length === 0) return null;
  const avg = (pick: (m: CheckMeasures) => number | null) => {
    const xs = first.map((a) => pick(measuresOf(a))).filter((x): x is number => x !== null);
    return xs.length ? Math.round(mean(xs) * 100) / 100 : null;
  };
  return {
    checks: first.length,
    alignmentDelta: avg((m) => m.alignmentDelta),
    balancePercent: avg((m) => m.balancePercent),
    stereoArcsec: avg((m) => m.stereoArcsec),
    worthDots: avg((m) => m.worthDots),
  };
}

// ---- Alignment probe ----

/** Starting offset (CSS px) away from the calibrated position, so the user must align actively. */
export function alignmentJitter(trial: number, random: () => number): { dx: number; dy: number } {
  const sign = trial % 2 === 0 ? 1 : -1;
  return { dx: sign * Math.round(18 + random() * 14), dy: Math.round((random() - 0.5) * 12) };
}

// ---- Stereo probe ----

export type Side = 'up' | 'down' | 'left' | 'right';
export const SIDES: Side[] = ['up', 'down', 'left', 'right'];

export { mulberry32 };

export const STEREO_MAX_TRIALS = 30;

export class StereoProbe {
  readonly cfg: StaircaseConfig;
  private stair: StaircaseState;
  private side: Side;
  private seed: number;
  trials = 0;
  correct = 0;
  cantTell = 0;

  constructor(
    geometry: ScreenGeometry,
    dpr: number,
    private readonly random: () => number = Math.random,
  ) {
    const minArcsec = Math.max(40, pxToArcsec(1 / Math.max(1, dpr), geometry));
    this.cfg = {
      start: 800,
      min: minArcsec,
      max: 1600,
      step: 1.4,
      up: 2,
      down: 1,
      harderDirection: -1,
      maxReversals: 8,
      logarithmic: true,
    };
    this.stair = createStaircase(this.cfg);
    this.side = this.pickSide();
    this.seed = this.pickSeed();
  }

  private pickSide(): Side {
    return SIDES[Math.floor(this.random() * 4)] ?? 'up';
  }

  private pickSeed(): number {
    return Math.floor(this.random() * 2 ** 31);
  }

  get done(): boolean {
    return this.stair.done || this.trials >= STEREO_MAX_TRIALS;
  }

  get current(): { arcsec: number; side: Side; seed: number; trial: number } {
    return { arcsec: this.stair.value, side: this.side, seed: this.seed, trial: this.trials };
  }

  /** null = "I can't tell". No feedback is given; the next pattern follows. */
  respond(answer: Side | null): void {
    if (this.done) return;
    const ok = answer === this.side;
    this.trials += 1;
    if (ok) this.correct += 1;
    if (answer === null) this.cantTell += 1;
    this.stair = staircaseRespond(this.stair, ok, this.cfg);
    this.side = this.pickSide();
    this.seed = this.pickSeed();
  }

  result(): NonNullable<Assessment['stereo']> {
    let threshold = staircaseThreshold(this.stair);
    if (threshold === null) {
      // No reversal: either nothing was seen (no threshold), or everything was seen right
      // down to the finest disparity this screen can show — then the threshold is that floor.
      const last = this.stair.trials.slice(-3);
      const atFloor = this.stair.value <= this.cfg.min * 1.001;
      if (atFloor && last.length > 0 && last.every((t) => t.correct)) threshold = this.cfg.min;
    }
    return {
      thresholdArcsec: threshold === null ? null : Math.round(threshold),
      trials: this.trials,
      correct: this.correct,
      cantTell: this.cantTell,
      minArcsec: Math.round(this.cfg.min),
    };
  }
}

/** The random-dot field for one trial, laid out for a canvas of w × h CSS px. */
export function stereoTrialImage(args: {
  width: number;
  height: number;
  geometry: ScreenGeometry;
  dpr: number;
  arcsec: number;
  side: Side;
  seed: number;
}): { image: RdsImage; field: Rect; disparityPx: number } {
  const size = Math.round(Math.min(args.width, args.height) * 0.82);
  const field: Rect = {
    x: Math.round(args.width / 2 - size / 2),
    y: Math.round(args.height / 2 - size / 2),
    w: size,
    h: size,
  };
  const t = Math.round(size * 0.26);
  const off = size * 0.24;
  const cx = field.x + size / 2;
  const cy = field.y + size / 2;
  const c =
    args.side === 'up'
      ? { x: cx, y: cy - off }
      : args.side === 'down'
        ? { x: cx, y: cy + off }
        : args.side === 'left'
          ? { x: cx - off, y: cy }
          : { x: cx + off, y: cy };
  const disparityPx = snapDisparity(arcsecToPx(args.arcsec, args.geometry), args.dpr);
  const image = generateRds({
    field,
    target: { x: c.x - t / 2, y: c.y - t / 2, w: t, h: t },
    dotSize: 4,
    density: 0.45,
    disparityPx,
    random: mulberry32(args.seed),
  });
  return { image, field, disparityPx };
}
