import type { ModuleId, SafetyEvent, SessionRecord, SymptomCheck } from '../data/schema';
import { dayKeyOffset } from '../data/util';
import type { Series, SeriesPoint } from './charts';

/** Sessions that count for trends: finished (completed or stopped), oldest first. */
export function finishedSessions(sessions: SessionRecord[], moduleId?: ModuleId): SessionRecord[] {
  return sessions
    .filter(
      (s) => (s.status === 'completed' || s.status === 'stopped') && (!moduleId || s.moduleId === moduleId),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

/** Training minutes per day for the last `days` days (oldest first). */
export function minutesPerDay(sessions: SessionRecord[], days: number, now = new Date()): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKeyOffset(-i, now);
    const mins = sessions.filter((s) => s.day === key).reduce((a, s) => a + s.actualMinutes, 0);
    out.push({ label: key.slice(5).replace('-', '/'), value: Math.round(mins * 10) / 10 });
  }
  return out;
}

/** One point per finished session of a module, from a metric or from the session intensity. */
export function perSession(
  sessions: SessionRecord[],
  moduleId: ModuleId,
  pick: (s: SessionRecord) => number | undefined | null,
  locale: string,
  limit = 30,
): SeriesPoint[] {
  return finishedSessions(sessions, moduleId)
    .slice(-limit)
    .map((s) => {
      const v = pick(s);
      return {
        label: shortDate(s.startedAt, locale),
        value: v === undefined || v === null || !Number.isFinite(v) ? null : v,
      };
    });
}

export function metric(name: string) {
  return (s: SessionRecord) => s.metrics[name];
}

/** Two aligned series from one module (e.g. vergence break and recovery). */
export function pairedSeries(
  sessions: SessionRecord[],
  moduleId: ModuleId,
  a: { name: string; key: string },
  b: { name: string; key: string },
  locale: string,
): Series[] {
  return [
    { name: a.name, points: perSession(sessions, moduleId, metric(a.key), locale) },
    { name: b.name, points: perSession(sessions, moduleId, metric(b.key), locale) },
  ];
}

/** Post-session diplopia frequency (0 never … 4 always), one point per post check. */
export function diplopiaTimeline(checks: SymptomCheck[], locale: string, limit = 30): SeriesPoint[] {
  return checks
    .filter((c) => c.phase === 'post')
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit)
    .map((c) => ({ label: shortDate(c.at, locale), value: c.diplopia }));
}

export interface ReportSummary {
  from: string;
  to: string;
  sessions: number;
  completed: number;
  stopped: number;
  minutes: number;
  daysTrained: number;
  daysInRange: number;
  perModule: Array<{ moduleId: ModuleId; sessions: number; minutes: number }>;
  diplopiaSessions: number;
  headacheSessions: number;
  redFlags: number;
  stops: number;
  flashPauses: number;
}

/** Aggregate figures for the clinician report over [fromKey, toKey] (YYYY-MM-DD, inclusive). */
export function summarize(
  sessions: SessionRecord[],
  checks: SymptomCheck[],
  events: SafetyEvent[],
  fromKey: string,
  toKey: string,
): ReportSummary {
  const inRange = sessions.filter((s) => s.day >= fromKey && s.day <= toKey && s.status !== 'in-progress');
  const checksInRange = checks.filter(
    (c) => c.phase === 'post' && c.at.slice(0, 10) >= fromKey && c.at.slice(0, 10) <= toKey,
  );
  const eventsInRange = events.filter((e) => e.at.slice(0, 10) >= fromKey && e.at.slice(0, 10) <= toKey);
  const modules = Array.from(new Set(inRange.map((s) => s.moduleId)));
  const dayMs = 86_400_000;
  const daysInRange = Math.round((Date.parse(toKey) - Date.parse(fromKey)) / dayMs) + 1;
  return {
    from: fromKey,
    to: toKey,
    sessions: inRange.length,
    completed: inRange.filter((s) => s.status === 'completed').length,
    stopped: inRange.filter((s) => s.status === 'stopped').length,
    minutes: Math.round(inRange.reduce((a, s) => a + s.actualMinutes, 0) * 10) / 10,
    daysTrained: new Set(inRange.map((s) => s.day)).size,
    daysInRange,
    perModule: modules.map((moduleId) => {
      const m = inRange.filter((s) => s.moduleId === moduleId);
      return {
        moduleId,
        sessions: m.length,
        minutes: Math.round(m.reduce((a, s) => a + s.actualMinutes, 0) * 10) / 10,
      };
    }),
    diplopiaSessions: checksInRange.filter((c) => c.diplopia >= 2).length,
    headacheSessions: checksInRange.filter((c) => c.headache >= 2).length,
    redFlags: eventsInRange.filter((e) => e.type === 'red-flag').length,
    stops: eventsInRange.filter((e) => e.type === 'stop').length,
    flashPauses: eventsInRange.filter((e) => e.type === 'flash-pause').length,
  };
}

/** First and latest non-null values of a per-session metric in a module. */
export function firstAndLatest(
  sessions: SessionRecord[],
  moduleId: ModuleId,
  pick: (s: SessionRecord) => number | undefined | null,
): { first: number; latest: number; best: number; n: number } | null {
  const vals = finishedSessions(sessions, moduleId)
    .map(pick)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return null;
  return { first: vals[0]!, latest: vals[vals.length - 1]!, best: Math.min(...vals), n: vals.length };
}
