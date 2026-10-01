import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS } from '../../src/data/schema';
import {
  allowedSessionMinutes,
  isBreakDue,
  isDailyCapReached,
  minutesUsedOnDay,
  nextMicroBreak,
  remainingDailyMinutes,
} from '../../src/safety/caps';
import { makeSession } from '../fixtures/factories';

describe('daily caps', () => {
  it('sums minutes across ALL modules for the day, including an in-progress session', () => {
    const now = Date.parse('2026-09-01T12:10:00.000Z');
    const sessions = [
      makeSession({ moduleId: 'l1', day: '2026-09-01', actualMinutes: 4 }),
      makeSession({ moduleId: 'l2', day: '2026-09-01', actualMinutes: 5 }),
      makeSession({ moduleId: 'l1', day: '2026-08-31', actualMinutes: 10 }),
      makeSession({
        moduleId: 'l2',
        day: '2026-09-01',
        status: 'in-progress',
        startedAt: '2026-09-01T12:00:00.000Z',
        endedAt: null,
        actualMinutes: 0,
      }),
    ];
    expect(minutesUsedOnDay(sessions, '2026-09-01', now)).toBeCloseTo(19, 5);
  });

  it('blocks a new session when the global cap is reached', () => {
    expect(isDailyCapReached(DEFAULT_CAPS, 30)).toBe(true);
    expect(isDailyCapReached(DEFAULT_CAPS, 29.9)).toBe(false);
    expect(allowedSessionMinutes(DEFAULT_CAPS, 5, 30)).toBe(0);
  });

  it('clips a session to the remaining daily budget and the session max', () => {
    expect(remainingDailyMinutes(DEFAULT_CAPS, 27)).toBe(3);
    expect(allowedSessionMinutes(DEFAULT_CAPS, 5, 27)).toBe(3);
    expect(allowedSessionMinutes(DEFAULT_CAPS, 25, 0)).toBe(DEFAULT_CAPS.sessionMaxMinutes);
    expect(allowedSessionMinutes(DEFAULT_CAPS, 4, 0)).toBe(4);
  });
});

describe('micro-breaks', () => {
  const caps = { ...DEFAULT_CAPS, microBreakEveryMinutes: 5, microBreakSeconds: 45 };
  it('schedules a break every 5 minutes within a 12 minute session', () => {
    const sessionMs = 12 * 60000;
    expect(nextMicroBreak(caps, 0, sessionMs, 0).nextBreakAtMs).toBe(5 * 60000);
    expect(isBreakDue(caps, 5 * 60000, sessionMs, 0)).toBe(true);
    expect(isBreakDue(caps, 4 * 60000, sessionMs, 0)).toBe(false);
    expect(nextMicroBreak(caps, 5 * 60000, sessionMs, 1).nextBreakAtMs).toBe(10 * 60000);
  });
  it('does not schedule a break in the last minute of a session', () => {
    const sessionMs = 5.5 * 60000;
    expect(nextMicroBreak(caps, 0, sessionMs, 0).nextBreakAtMs).toBeNull();
  });
});
