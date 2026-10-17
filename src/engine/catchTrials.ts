import type { Eye } from './units';

/**
 * Monocular catch trials ("only one eye can see this"), shared by every module.
 *
 * Every 25–45 s of active training a small diamond appears for 2.5 s in ONE eye's picture
 * only, near a corner of the stimulus area. The user presses C (or the on-screen button)
 * when they see it. Because only one eye gets the diamond, the answers show, per eye,
 * whether that eye's picture is getting through — and presses without any diamond show how
 * reliable the reports are. L1 has its own version of this (the chick), so it opts out.
 *
 * Pure logic: the caller draws `current` and calls update() only while the stimulus runs.
 */

export interface CatchTrialOptions {
  minGapMs: number;
  maxGapMs: number;
  showMs: number;
  /** A press this soon after the diamond disappears still counts as seen. */
  graceMs: number;
}

export const DEFAULT_CATCH_OPTIONS: CatchTrialOptions = {
  minGapMs: 25_000,
  maxGapMs: 45_000,
  showMs: 2500,
  graceMs: 600,
};

export interface CatchTarget {
  eye: Eye;
  /** Position inside the stimulus area, 0..1 on each axis (near one of the corners). */
  u: number;
  v: number;
}

export interface CatchMetrics {
  catchShownLeft: number;
  catchShownRight: number;
  catchHitLeft: number;
  catchHitRight: number;
  catchFalseAlarms: number;
}

const CORNERS: Array<[number, number]> = [
  [0.1, 0.12],
  [0.9, 0.12],
  [0.1, 0.88],
  [0.9, 0.88],
];

export class CatchTrials {
  private activeMs = 0;
  private nextAt: number;
  private shownAt: number | null = null;
  private target: CatchTarget | null = null;
  private lastEnded: { at: number; eye: Eye; answered: boolean } | null = null;
  /** Eyes still to come in the current pair, so left and right stay balanced. */
  private pair: Eye[] = [];
  private m: CatchMetrics = {
    catchShownLeft: 0,
    catchShownRight: 0,
    catchHitLeft: 0,
    catchHitRight: 0,
    catchFalseAlarms: 0,
  };

  constructor(
    private readonly random: () => number,
    private readonly opts: CatchTrialOptions = DEFAULT_CATCH_OPTIONS,
  ) {
    this.nextAt = this.gap();
  }

  private gap(): number {
    return this.opts.minGapMs + this.random() * (this.opts.maxGapMs - this.opts.minGapMs);
  }

  private nextEye(): Eye {
    if (this.pair.length === 0) this.pair = this.random() < 0.5 ? ['left', 'right'] : ['right', 'left'];
    return this.pair.shift()!;
  }

  /** The diamond to draw now, if any. */
  get current(): CatchTarget | null {
    return this.target;
  }

  /**
   * Advance by the active (drawn) time. `allow` lets the caller veto an onset, e.g. through
   * the transition guard; a vetoed onset is retried on the next frame.
   */
  update(dtMs: number, allow: () => boolean = () => true): void {
    this.activeMs += dtMs;
    if (this.target && this.shownAt !== null) {
      if (this.activeMs - this.shownAt >= this.opts.showMs) {
        this.lastEnded = { at: this.activeMs, eye: this.target.eye, answered: false };
        this.target = null;
        this.shownAt = null;
        this.nextAt = this.activeMs + this.gap();
      }
      return;
    }
    if (this.activeMs >= this.nextAt && allow()) {
      const eye = this.nextEye();
      const [u, v] = CORNERS[Math.floor(this.random() * CORNERS.length)] ?? [0.1, 0.12];
      this.target = { eye, u, v };
      this.shownAt = this.activeMs;
      if (eye === 'left') this.m.catchShownLeft += 1;
      else this.m.catchShownRight += 1;
    }
  }

  /** The user says "I saw it". */
  respond(): 'hit' | 'late-hit' | 'false-alarm' {
    if (this.target) {
      this.recordHit(this.target.eye);
      this.lastEnded = { at: this.activeMs, eye: this.target.eye, answered: true };
      this.target = null;
      this.shownAt = null;
      this.nextAt = this.activeMs + this.gap();
      return 'hit';
    }
    const last = this.lastEnded;
    if (last && !last.answered && this.activeMs - last.at <= this.opts.graceMs) {
      this.recordHit(last.eye);
      last.answered = true;
      return 'late-hit';
    }
    this.m.catchFalseAlarms += 1;
    return 'false-alarm';
  }

  private recordHit(eye: Eye): void {
    if (eye === 'left') this.m.catchHitLeft += 1;
    else this.m.catchHitRight += 1;
  }

  metrics(): CatchMetrics {
    return { ...this.m };
  }
}
