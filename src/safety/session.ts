import { getDb } from '../data/db';
import type {
  CalibrationProfile,
  ModuleId,
  ModuleProgress,
  SafetyEvent,
  SessionRecord,
  Settings,
  SymptomCheck,
} from '../data/schema';
import { sanitizeText } from '../data/sanitize';
import { dayKey, minutesBetween, newId, nowIso } from '../data/util';
import { stepBackGame, stepBackVisual } from '../modules/adaptive';
import type { ModuleDefinition } from '../modules/types';
import { discomfortReported, hasRedFlag, shouldLockProgression, type RedFlagReport } from './symptomRules';

export function createSessionRecord(args: {
  moduleId: ModuleId;
  calibration: CalibrationProfile;
  rendererId: string;
  plannedMinutes: number;
  progress: ModuleProgress;
  metric: string;
  postureNote: string;
  preCheckId: string | null;
}): SessionRecord {
  const now = nowIso();
  return {
    id: newId('ses'),
    moduleId: args.moduleId,
    calibrationId: args.calibration.id,
    rendererId: args.rendererId,
    startedAt: now,
    endedAt: null,
    day: dayKey(),
    plannedMinutes: args.plannedMinutes,
    actualMinutes: 0,
    intensityTier: args.progress.intensityTier,
    intensityValue: args.progress.intensityValue,
    intensityMetric: args.metric,
    gameDifficulty: args.progress.gameDifficulty,
    viewingDistanceCm: args.calibration.viewingDistanceCm,
    postureNote: sanitizeText(args.postureNote, 500),
    status: 'in-progress',
    preCheckId: args.preCheckId,
    postCheckId: null,
    events: [{ at: now, type: 'start' }],
    metrics: {},
    notes: '',
  };
}

export async function saveSession(session: SessionRecord): Promise<void> {
  await getDb().sessions.put(session);
}

export async function saveCheck(check: SymptomCheck): Promise<void> {
  await getDb().symptomChecks.put(check);
}

export async function recordSafetyEvent(
  type: SafetyEvent['type'],
  details: string,
  sessionId: string | null = null,
): Promise<SafetyEvent> {
  const ev: SafetyEvent = {
    id: newId('sev'),
    at: nowIso(),
    type,
    sessionId,
    details: sanitizeText(details, 500),
  };
  await getDb().safetyEvents.put(ev);
  return ev;
}

export function finalizeSession(
  session: SessionRecord,
  status: SessionRecord['status'],
  metrics: Record<string, number>,
): SessionRecord {
  const endedAt = nowIso();
  return {
    ...session,
    endedAt,
    actualMinutes: Math.round(minutesBetween(session.startedAt, endedAt) * 100) / 100,
    status,
    metrics: { ...session.metrics, ...metrics },
    events: [...session.events, { at: endedAt, type: status === 'completed' ? 'complete' : 'stop' }],
  };
}

/** Mark any session left in-progress by a crash/close as recovered, using its last heartbeat. */
export async function recoverInProgressSessions(): Promise<number> {
  const db = getDb();
  const stale = await db.sessions.where('status').equals('in-progress').toArray();
  for (const s of stale) {
    const heartbeat = s.metrics['lastHeartbeatMs'];
    const endedAt = heartbeat ? new Date(heartbeat).toISOString() : s.startedAt;
    await db.sessions.put({
      ...s,
      status: 'recovered',
      endedAt,
      actualMinutes: Math.round(minutesBetween(s.startedAt, endedAt) * 100) / 100,
      events: [...s.events, { at: nowIso(), type: 'recovered' }],
    });
  }
  return stale.length;
}

export interface PostCheckOutcome {
  progress: ModuleProgress;
  steppedBack: boolean;
  progressionLocked: boolean;
  trainingLocked: boolean;
}

/**
 * Apply the safety rules after a post-session (or STOP) symptom check:
 *  - red flag -> training lock;
 *  - any discomfort -> immediate visual step back (and game step back if repeated failure);
 *  - diplopia in 2+ consecutive sessions -> progression lock, advise orthoptist.
 */
export function applyPostCheckRules(args: {
  def: ModuleDefinition;
  check: SymptomCheck;
  redFlags: RedFlagReport;
  progress: ModuleProgress;
  calibration: CalibrationProfile;
  settings: Pick<Settings, 'progressionLock' | 'clinicianAgreement'>;
  /** Post checks newest first, INCLUDING this one. */
  postChecksNewestFirst: SymptomCheck[];
}): PostCheckOutcome {
  const ctx = { settings: args.settings, calibration: args.calibration };
  let progress = args.progress;
  let steppedBack = false;
  if (discomfortReported(args.check)) {
    progress = stepBackVisual(args.def, progress, ctx);
    steppedBack = true;
    if (args.check.diplopia >= 3) progress = stepBackGame(progress, ctx);
  }
  const progressionLocked = shouldLockProgression(args.postChecksNewestFirst);
  const trainingLocked = hasRedFlag(args.redFlags);
  return { progress, steppedBack, progressionLocked, trainingLocked };
}
