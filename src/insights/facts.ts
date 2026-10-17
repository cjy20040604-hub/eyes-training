import { sessionCatch, sessionInconsistencies, type EyeCatch } from '../data/consistency';
import type { SafetyEvent, SessionRecord, SymptomCheck } from '../data/schema';
import { dayKeyOffset } from '../data/util';
import { summarize } from '../dashboard/trends';

/**
 * The weekly recap's single source of truth. Everything the AI may say comes from this
 * object; the guardrails reject any number that is not in it. Computed on the device.
 */

export interface EyeRate {
  /** Rounded percentage of one-eye check points reported as seen; null when none were shown. */
  seenPercent: number | null;
  shown: number;
}

export interface WeeklyFacts {
  period: { from: string; to: string };
  thisWeek: {
    sessions: number;
    minutes: number;
    daysTrained: number;
    modules: Array<{ moduleId: string; name: string; sessions: number; minutes: number }>;
  };
  lastWeek: { sessions: number; minutes: number; daysTrained: number };
  /** Differences this week minus last week, so the model never has to calculate. */
  change: {
    sessions: number;
    minutes: number;
    leftSeenPoints: number | null;
    rightSeenPoints: number | null;
  };
  oneEyeChecks: {
    left: EyeRate;
    right: EyeRate;
    lastWeekLeft: EyeRate;
    lastWeekRight: EyeRate;
    pressesWithoutSymbol: number;
    doubtfulSessions: number;
  };
  difficulty: { raised: number; loweredForComfort: number };
  comfort: {
    doubleVisionReports: number;
    headacheReports: number;
    warningSymptoms: number;
    stops: number;
    doubleVisionPause: boolean;
  };
}

export type InsightGate =
  { kind: 'ok' } | { kind: 'safety' } | { kind: 'too-little'; sessions: number; needed: number };

export const MIN_SESSIONS_FOR_RECAP = 2;

export interface InsightData {
  sessions: SessionRecord[];
  checks: SymptomCheck[];
  safetyEvents: SafetyEvent[];
}

const rate = (e: EyeCatch): EyeRate => ({
  seenPercent: e.shown > 0 ? Math.round((e.seen / e.shown) * 100) : null,
  shown: e.shown,
});

const round1 = (n: number) => Math.round(n * 10) / 10;

function eyeTotals(sessions: SessionRecord[]) {
  const left: EyeCatch = { shown: 0, seen: 0 };
  const right: EyeCatch = { shown: 0, seen: 0 };
  let falseAlarms = 0;
  let doubtful = 0;
  let raised = 0;
  let lowered = 0;
  for (const s of sessions) {
    const c = sessionCatch(s);
    left.shown += c.left.shown;
    left.seen += c.left.seen;
    right.shown += c.right.shown;
    right.seen += c.right.seen;
    falseAlarms += c.falseAlarms;
    if (sessionInconsistencies(s).length) doubtful += 1;
    for (const e of s.events) {
      if (e.type === 'step-up') raised += 1;
      if (e.type === 'step-back') lowered += 1;
    }
  }
  return { left, right, falseAlarms, doubtful, raised, lowered };
}

/** Facts for the 7 days ending on `today` (YYYY-MM-DD), compared with the 7 days before. */
export function weeklyFacts(
  data: InsightData,
  today: Date,
  moduleName: (moduleId: string) => string,
): WeeklyFacts {
  const to = dayKeyOffset(0, today);
  const from = dayKeyOffset(-6, today);
  const lastTo = dayKeyOffset(-7, today);
  const lastFrom = dayKeyOffset(-13, today);
  const done = (s: SessionRecord) => s.status === 'completed' || s.status === 'stopped';
  const inWeek = (s: SessionRecord, a: string, b: string) => done(s) && s.day >= a && s.day <= b;

  const now = summarize(data.sessions, data.checks, data.safetyEvents, from, to);
  const prev = summarize(data.sessions, data.checks, data.safetyEvents, lastFrom, lastTo);
  const cur = eyeTotals(data.sessions.filter((s) => inWeek(s, from, to)));
  const old = eyeTotals(data.sessions.filter((s) => inWeek(s, lastFrom, lastTo)));
  const left = rate(cur.left);
  const right = rate(cur.right);
  const lastLeft = rate(old.left);
  const lastRight = rate(old.right);
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);
  const lock = data.safetyEvents.filter(
    (e) => e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to && e.type === 'diplopia-lock',
  );

  return {
    period: { from, to },
    thisWeek: {
      sessions: now.sessions,
      minutes: round1(now.minutes),
      daysTrained: now.daysTrained,
      modules: now.perModule
        .map((m) => ({
          moduleId: m.moduleId,
          name: moduleName(m.moduleId),
          sessions: m.sessions,
          minutes: m.minutes,
        }))
        .sort((a, b) => b.minutes - a.minutes),
    },
    lastWeek: { sessions: prev.sessions, minutes: round1(prev.minutes), daysTrained: prev.daysTrained },
    change: {
      sessions: now.sessions - prev.sessions,
      minutes: round1(now.minutes - prev.minutes),
      leftSeenPoints: diff(left.seenPercent, lastLeft.seenPercent),
      rightSeenPoints: diff(right.seenPercent, lastRight.seenPercent),
    },
    oneEyeChecks: {
      left,
      right,
      lastWeekLeft: lastLeft,
      lastWeekRight: lastRight,
      pressesWithoutSymbol: cur.falseAlarms,
      doubtfulSessions: cur.doubtful,
    },
    difficulty: { raised: cur.raised, loweredForComfort: cur.lowered },
    comfort: {
      doubleVisionReports: now.diplopiaSessions,
      headacheReports: now.headacheSessions,
      warningSymptoms: now.redFlags,
      stops: now.stops,
      doubleVisionPause: lock.length > 0,
    },
  };
}

/**
 * Whether a recap may be written at all. Weeks with double vision, moderate headaches or
 * warning symptoms never
 * go to the model: the app shows a fixed message pointing to a clinician instead.
 */
export function insightGate(f: WeeklyFacts): InsightGate {
  const c = f.comfort;
  if (c.warningSymptoms > 0 || c.doubleVisionReports > 0 || c.headacheReports > 0 || c.doubleVisionPause)
    return { kind: 'safety' };
  if (f.thisWeek.sessions < MIN_SESSIONS_FOR_RECAP)
    return { kind: 'too-little', sessions: f.thisWeek.sessions, needed: MIN_SESSIONS_FOR_RECAP };
  return { kind: 'ok' };
}

/** Every number the recap may mention: the facts' own numbers (and their sizes), 7 and 100. */
export function allowedNumbers(f: WeeklyFacts): Set<number> {
  const out = new Set<number>([7, 100]);
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(v);
      out.add(Math.abs(v));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk({ ...f, period: undefined });
  return out;
}

/** The facts as the model sees them: no internal ids, English module names. */
export function factsForModel(f: WeeklyFacts) {
  return {
    thisWeek: {
      ...f.thisWeek,
      modules: f.thisWeek.modules.map(({ name, sessions, minutes }) => ({ name, sessions, minutes })),
    },
    lastWeek: f.lastWeek,
    change: f.change,
    oneEyeChecks: f.oneEyeChecks,
    difficulty: f.difficulty,
  };
}
