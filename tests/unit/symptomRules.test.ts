import { describe, expect, it } from 'vitest';
import {
  consecutiveDiplopiaSessions,
  discomfortReported,
  emptyRedFlagReport,
  hasRedFlag,
  isCleanCheck,
  shouldLockProgression,
} from '../../src/safety/symptomRules';
import { makeCheck } from '../fixtures/factories';

describe('symptom rules', () => {
  it('locks progression after diplopia in 2 consecutive post-session checks', () => {
    const checks = [
      makeCheck({ at: '2026-09-03T10:00:00Z', diplopia: 2 }),
      makeCheck({ at: '2026-09-02T10:00:00Z', diplopia: 3 }),
      makeCheck({ at: '2026-09-01T10:00:00Z', diplopia: 0 }),
    ];
    expect(consecutiveDiplopiaSessions(checks)).toBe(2);
    expect(shouldLockProgression(checks)).toBe(true);
  });

  it('does not lock when diplopia sessions are not consecutive', () => {
    const checks = [makeCheck({ diplopia: 2 }), makeCheck({ diplopia: 0 }), makeCheck({ diplopia: 2 })];
    expect(consecutiveDiplopiaSessions(checks)).toBe(1);
    expect(shouldLockProgression(checks)).toBe(false);
  });

  it('"rarely" does not count as diplopia reported', () => {
    expect(shouldLockProgression([makeCheck({ diplopia: 1 }), makeCheck({ diplopia: 1 })])).toBe(false);
  });

  it('ignores pre and stop phase checks in the consecutive count', () => {
    const checks = [
      makeCheck({ diplopia: 2 }),
      makeCheck({ phase: 'pre', diplopia: 0 }),
      makeCheck({ diplopia: 2 }),
    ];
    expect(consecutiveDiplopiaSessions(checks)).toBe(2);
  });

  it('discomfort triggers on diplopia, moderate headache, any nausea, moderate eyestrain/confusion', () => {
    expect(discomfortReported(makeCheck())).toBe(false);
    expect(discomfortReported(makeCheck({ diplopia: 2 }))).toBe(true);
    expect(discomfortReported(makeCheck({ headache: 2 }))).toBe(true);
    expect(discomfortReported(makeCheck({ headache: 1 }))).toBe(false);
    expect(discomfortReported(makeCheck({ nausea: 1 }))).toBe(true);
    expect(discomfortReported(makeCheck({ eyestrain: 2 }))).toBe(true);
    expect(discomfortReported(makeCheck({ confusion: 2 }))).toBe(true);
  });

  it('clean check = diplopia never/rarely, headache none/mild, no nausea', () => {
    expect(isCleanCheck(makeCheck({ diplopia: 1, headache: 1 }))).toBe(true);
    expect(isCleanCheck(makeCheck({ diplopia: 2 }))).toBe(false);
    expect(isCleanCheck(makeCheck({ nausea: 1 }))).toBe(false);
  });

  it('any red flag counts', () => {
    expect(hasRedFlag(emptyRedFlagReport())).toBe(false);
    expect(hasRedFlag({ ...emptyRedFlagReport(), ptosis: true })).toBe(true);
    expect(hasRedFlag({ ...emptyRedFlagReport(), otherNeurological: true })).toBe(true);
  });
});
