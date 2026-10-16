import { describe, expect, it, vi } from 'vitest';
import {
  trainedDaysThisWeek,
  trainedToday,
  updateAppBadge,
  weekDays,
  weekStart,
  weeklyProgress,
} from '../../src/data/goals';
import { buildReminderIcs, escapeIcsText, firstOccurrence, foldIcsLine } from '../../src/data/ics';
import { makeSession } from '../fixtures/factories';

// Thursday 15 October 2026, 18:00 local time.
const THU = new Date(2026, 9, 15, 18, 0, 0);

describe('weekly goal', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekStart(THU).getDay()).toBe(1);
    expect(weekDays(THU)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(weekStart(new Date(2026, 9, 18, 12)).getDate()).toBe(12); // Sunday belongs to that week
  });

  it('counts days with a completed session, not sessions or minutes', () => {
    const sessions = [
      makeSession({ day: '2026-10-12', status: 'completed' }),
      makeSession({ day: '2026-10-12', status: 'completed' }),
      makeSession({ day: '2026-10-13', status: 'stopped' }),
      makeSession({ day: '2026-10-14', status: 'completed' }),
      makeSession({ day: '2026-10-09', status: 'completed' }), // last week
    ];
    expect(trainedDaysThisWeek(sessions, THU)).toEqual(['2026-10-12', '2026-10-14']);
    expect(trainedToday(sessions, THU)).toBe(false);
    expect(weeklyProgress(sessions, 4, THU)).toEqual({
      done: 2,
      goal: 4,
      daysLeft: 3,
      reached: false,
      outOfReach: false,
    });
    expect(weeklyProgress(sessions, 2, THU).reached).toBe(true);
    // Saturday with 1 day done and a goal of 4: no longer reachable this week.
    expect(weeklyProgress(sessions.slice(0, 1), 4, new Date(2026, 9, 17, 9)).outOfReach).toBe(true);
  });

  it('sets the app badge on untrained days and clears it after training', async () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, setAppBadge, clearAppBadge });
    await updateAppBadge(false);
    await updateAppBadge(true);
    expect(setAppBadge).toHaveBeenCalledTimes(1);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    await expect(updateAppBadge(false)).resolves.toBeUndefined(); // unsupported: no error
  });
});

describe('calendar reminder (.ics)', () => {
  it('finds the next chosen weekday at the chosen time', () => {
    // Thursday 18:00, reminders Mon/Thu at 19:00 -> today 19:00.
    expect(firstOccurrence([1, 4], '19:00', THU)).toEqual(new Date(2026, 9, 15, 19, 0, 0));
    // Thursday 18:00, reminders Mon/Thu at 08:00 -> next Monday.
    expect(firstOccurrence([1, 4], '08:00', THU)).toEqual(new Date(2026, 9, 19, 8, 0, 0));
  });

  it('builds a valid weekly event with an alarm', () => {
    const ics = buildReminderIcs({
      weekdays: [6, 1, 3],
      time: '19:30',
      title: 'Eye training',
      description: 'Wear the glasses; stop if unwell',
      url: 'https://example.org/eyes/',
      now: THU,
      uid: 'test@eyes-training',
    });
    const lines = ics.split('\r\n');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,SA');
    expect(lines).toContain('DTSTART:20261017T193000');
    expect(lines).toContain('UID:test@eyes-training');
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('SUMMARY:Eye training');
    expect(ics).toContain('DESCRIPTION:Wear the glasses\\; stop if unwell\\nhttps://example.org/eyes/');
    expect(lines.filter((l) => l.startsWith('BEGIN:')).length).toBe(
      lines.filter((l) => l.startsWith('END:')).length,
    );
  });

  it('refuses an empty day list', () => {
    expect(() => buildReminderIcs({ weekdays: [], time: '19:00', title: 't', description: 'd' })).toThrow();
  });

  it('escapes text and folds long lines (by bytes, never inside a character)', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `DESCRIPTION:${'双眼训练'.repeat(20)}`;
    const folded = foldIcsLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
  });
});
