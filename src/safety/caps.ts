import type { Caps, SessionRecord } from '../data/schema';

/** Minutes of training already used on `day` across ALL modules, including any in-progress session. */
export function minutesUsedOnDay(sessions: SessionRecord[], day: string, nowMs = Date.now()): number {
  let total = 0;
  for (const s of sessions) {
    if (s.day !== day) continue;
    if (s.status === 'in-progress') {
      total += Math.max(0, (nowMs - new Date(s.startedAt).getTime()) / 60000);
    } else {
      total += s.actualMinutes;
    }
  }
  return total;
}

export function remainingDailyMinutes(caps: Caps, usedMinutes: number): number {
  return Math.max(0, caps.dailyCapMinutes - usedMinutes);
}

export function isDailyCapReached(caps: Caps, usedMinutes: number): boolean {
  return usedMinutes >= caps.dailyCapMinutes;
}

/** Minutes this session may run: min(planned, session max, remaining daily). Zero means blocked. */
export function allowedSessionMinutes(caps: Caps, plannedMinutes: number, usedMinutes: number): number {
  const remaining = remainingDailyMinutes(caps, usedMinutes);
  return Math.max(0, Math.min(plannedMinutes, caps.sessionMaxMinutes, remaining));
}

export interface BreakSchedule {
  /** Elapsed ms at which the next micro-break should start, or null if none before the end. */
  nextBreakAtMs: number | null;
  breakDurationMs: number;
}

export function nextMicroBreak(
  caps: Caps,
  elapsedMs: number,
  sessionMs: number,
  breaksTaken: number,
): BreakSchedule {
  const every = caps.microBreakEveryMinutes * 60000;
  const next = every * (breaksTaken + 1);
  // Do not schedule a break within the last minute of the session.
  const nextBreakAtMs = next < sessionMs - 60000 && next >= elapsedMs - every ? next : null;
  return { nextBreakAtMs, breakDurationMs: caps.microBreakSeconds * 1000 };
}

export function isBreakDue(caps: Caps, elapsedMs: number, sessionMs: number, breaksTaken: number): boolean {
  const { nextBreakAtMs } = nextMicroBreak(caps, elapsedMs, sessionMs, breaksTaken);
  return nextBreakAtMs !== null && elapsedMs >= nextBreakAtMs;
}
