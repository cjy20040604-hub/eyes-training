import { describe, expect, it } from 'vitest';
import {
  createStaircase,
  staircaseRespond,
  staircaseThreshold,
  type StaircaseConfig,
} from '../../src/engine/staircase';

const cfg: StaircaseConfig = {
  start: 1,
  min: 0.05,
  max: 1,
  step: 0.1,
  up: 1,
  down: 1,
  harderDirection: -1,
  maxReversals: 4,
  stepAfterReversals: [{ reversals: 2, step: 0.05 }],
};

describe('staircase', () => {
  it('steps harder (down) on correct and easier (up) on incorrect', () => {
    let s = createStaircase(cfg);
    s = staircaseRespond(s, true, cfg);
    expect(s.value).toBeCloseTo(0.9);
    s = staircaseRespond(s, false, cfg);
    expect(s.value).toBeCloseTo(1.0);
    expect(s.reversals).toHaveLength(1);
  });

  it('clamps to bounds', () => {
    let s = createStaircase(cfg);
    s = staircaseRespond(s, false, cfg);
    expect(s.value).toBe(1);
  });

  it('shrinks the step after the configured reversals and finishes at maxReversals', () => {
    let s = createStaircase(cfg);
    const answers = [true, true, false, true, false, true, false];
    for (const a of answers) s = staircaseRespond(s, a, cfg);
    expect(s.reversals.length).toBeGreaterThanOrEqual(4);
    expect(s.done).toBe(true);
    expect(s.step).toBe(0.05);
    const th = staircaseThreshold(s);
    expect(th).not.toBeNull();
    expect(th!).toBeGreaterThan(0.5);
    expect(th!).toBeLessThanOrEqual(1);
  });

  it('ignores responses once done', () => {
    let s = createStaircase({ ...cfg, maxReversals: 1 });
    s = staircaseRespond(s, true, cfg);
    s = staircaseRespond(s, false, { ...cfg, maxReversals: 1 });
    expect(s.done).toBe(true);
    const frozen = staircaseRespond(s, true, { ...cfg, maxReversals: 1 });
    expect(frozen).toBe(s);
  });

  it('supports logarithmic steps', () => {
    const log: StaircaseConfig = { ...cfg, start: 800, min: 40, max: 1600, step: 2, logarithmic: true };
    let s = createStaircase(log);
    s = staircaseRespond(s, true, log);
    expect(s.value).toBe(400);
    s = staircaseRespond(s, false, log);
    expect(s.value).toBe(800);
  });
});
