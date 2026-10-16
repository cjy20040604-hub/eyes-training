import type { SessionRecord } from './schema';
import { dayKey } from './util';

/**
 * Weekly goal: the number of days this week (Monday to Sunday, local time) with at least
 * one completed session. Days count, not minutes: regular short sessions matter more than
 * a long one, and a rest day is never a failure.
 */

/** Monday 00:00 (local) of the week containing `now`. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d;
}

/** The seven local day keys of the current week, Monday first. */
export function weekDays(now = new Date()): string[] {
  const start = weekStart(now);
  return Array.from({ length: 7 }, (_, i) =>
    dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
  );
}

export function trainedDaysThisWeek(sessions: SessionRecord[], now = new Date()): string[] {
  const days = new Set(weekDays(now));
  return [
    ...new Set(sessions.filter((s) => s.status === 'completed' && days.has(s.day)).map((s) => s.day)),
  ].sort();
}

export function trainedToday(sessions: SessionRecord[], now = new Date()): boolean {
  const today = dayKey(now);
  return sessions.some((s) => s.status === 'completed' && s.day === today);
}

export interface WeeklyProgress {
  done: number;
  goal: number;
  /** Days still left in the week after today. */
  daysLeft: number;
  reached: boolean;
  /** The goal can no longer be reached this week. */
  outOfReach: boolean;
}

export function weeklyProgress(sessions: SessionRecord[], goal: number, now = new Date()): WeeklyProgress {
  const done = trainedDaysThisWeek(sessions, now).length;
  const todayIndex = (now.getDay() + 6) % 7;
  const daysLeft = 6 - todayIndex;
  const possible = done + daysLeft + (trainedToday(sessions, now) ? 0 : 1);
  return { done, goal, daysLeft, reached: done >= goal, outOfReach: possible < goal };
}

// ---- App icon badge (installed app only; ignored elsewhere) ----

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Show a dot on the installed app's icon on days without training yet. */
export async function updateAppBadge(trained: boolean): Promise<void> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as BadgeNavigator | undefined;
  if (!nav?.setAppBadge || !nav.clearAppBadge) return;
  try {
    if (trained) await nav.clearAppBadge();
    else await nav.setAppBadge();
  } catch {
    // Not installed or not permitted: nothing to do.
  }
}
