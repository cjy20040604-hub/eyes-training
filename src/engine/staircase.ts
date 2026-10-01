/**
 * Generic adaptive staircase (n-up / m-down) with reversal tracking. Used for the
 * dichoptic contrast balance point and, later, stereo disparity thresholds.
 *
 * "Harder" is defined by the caller via harderDirection.
 */
export interface StaircaseConfig {
  start: number;
  min: number;
  max: number;
  /** Step size; may shrink after reversals via stepAfterReversals. */
  step: number;
  /** Consecutive correct responses required before stepping harder. */
  up: number;
  /** Consecutive incorrect responses before stepping easier (usually 1). */
  down: number;
  /** +1 if increasing value = harder, -1 if decreasing value = harder. */
  harderDirection: 1 | -1;
  /** Stop after this many reversals. */
  maxReversals: number;
  /** Optional step size schedule keyed by reversal count reached. */
  stepAfterReversals?: Array<{ reversals: number; step: number }>;
  /** Multiplicative (log) steps instead of additive. */
  logarithmic?: boolean;
}

export interface StaircaseState {
  value: number;
  step: number;
  correctRun: number;
  incorrectRun: number;
  reversals: number[];
  lastMove: 1 | -1 | 0;
  trials: Array<{ value: number; correct: boolean }>;
  done: boolean;
}

export function createStaircase(config: StaircaseConfig): StaircaseState {
  return {
    value: clamp(config.start, config.min, config.max),
    step: config.step,
    correctRun: 0,
    incorrectRun: 0,
    reversals: [],
    lastMove: 0,
    trials: [],
    done: false,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function move(value: number, step: number, direction: 1 | -1, config: StaircaseConfig): number {
  const next = config.logarithmic ? value * (direction === 1 ? step : 1 / step) : value + direction * step;
  return clamp(next, config.min, config.max);
}

export function staircaseRespond(
  state: StaircaseState,
  correct: boolean,
  config: StaircaseConfig,
): StaircaseState {
  if (state.done) return state;
  const trials = [...state.trials, { value: state.value, correct }];
  let { value, step, correctRun, incorrectRun, lastMove } = state;
  const reversals = [...state.reversals];
  let moveDir: 1 | -1 | 0 = 0;

  if (correct) {
    correctRun += 1;
    incorrectRun = 0;
    if (correctRun >= config.up) {
      moveDir = config.harderDirection;
      correctRun = 0;
    }
  } else {
    incorrectRun += 1;
    correctRun = 0;
    if (incorrectRun >= config.down) {
      moveDir = (config.harderDirection * -1) as 1 | -1;
      incorrectRun = 0;
    }
  }

  if (moveDir !== 0) {
    if (lastMove !== 0 && moveDir !== lastMove) {
      reversals.push(value);
      const sched = config.stepAfterReversals?.find((s) => s.reversals === reversals.length);
      if (sched) step = sched.step;
    }
    value = move(value, step, moveDir, config);
    lastMove = moveDir;
  }

  const done = reversals.length >= config.maxReversals;
  return { value, step, correctRun, incorrectRun, reversals, lastMove, trials, done };
}

/** Threshold estimate = mean of the last `count` reversal values (default: all but the first two). */
export function staircaseThreshold(state: StaircaseState, count?: number): number | null {
  const r = state.reversals;
  if (r.length === 0) return null;
  const use = count ? r.slice(-count) : r.length > 2 ? r.slice(2) : r;
  return use.reduce((a, b) => a + b, 0) / use.length;
}
