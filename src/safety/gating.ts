import type { ModuleId, SessionRecord, Settings, SymptomCheck } from '../data/schema';
import { isCleanCheck } from './symptomRules';

/** Stable L1/L2 sessions required before L3–L5 unlock. */
export const STABLE_SESSIONS_REQUIRED = 6;
/** Those sessions must span at least this many distinct days. */
export const STABLE_DISTINCT_DAYS_REQUIRED = 3;
/** No STOP events allowed within the most recent N sessions. */
export const RECENT_SESSIONS_WITHOUT_STOP = 3;

export type GateRequirement = 'none' | 'stable-l1-l2' | 'stable-and-clinician';

export const MODULE_GATES: Record<ModuleId, GateRequirement> = {
  l1: 'none',
  l2: 'none',
  l3: 'stable-l1-l2',
  l4: 'stable-and-clinician',
  l5: 'stable-l1-l2',
  video: 'stable-l1-l2',
  // The Brock string asks for convergence, like L4.
  brock: 'stable-and-clinician',
  reading: 'stable-l1-l2',
};

/** Modules whose stimuli depend on an exact Δ / arcsec conversion: not with a quick calibration. */
export const NEEDS_FULL_CALIBRATION: ReadonlySet<ModuleId> = new Set<ModuleId>(['l4', 'l5', 'brock']);

export type GateReason =
  | 'needs-full-calibration'
  | 'training-locked'
  | 'disclaimer'
  | 'no-calibration'
  | 'needs-stable-sessions'
  | 'needs-distinct-days'
  | 'recent-stop'
  | 'clinician-agreement';

export interface GateResult {
  unlocked: boolean;
  reasons: GateReason[];
  stableSessions: number;
  distinctDays: number;
  needed: number;
  neededDays: number;
}

export interface GateContext {
  settings: Pick<
    Settings,
    'trainingLock' | 'clinicianAgreement' | 'disclaimerAcceptedVersion' | 'activeCalibrationId'
  >;
  /** All sessions, any order. */
  sessions: SessionRecord[];
  /** All symptom checks, any order. */
  checks: SymptomCheck[];
  disclaimerVersion: number;
  /** Quality of the active calibration ('quick' from the quick start). */
  calibrationQuality?: 'quick' | 'full';
}

export function stableCoreSessions(sessions: SessionRecord[], checks: SymptomCheck[]): SessionRecord[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  return sessions.filter((s) => {
    if (s.moduleId !== 'l1' && s.moduleId !== 'l2') return false;
    if (s.status !== 'completed') return false;
    if (s.events.some((e) => e.type === 'stop' || e.type === 'flash-pause')) return false;
    const post = s.postCheckId ? byId.get(s.postCheckId) : undefined;
    return !!post && isCleanCheck(post);
  });
}

export function evaluateGate(moduleId: ModuleId, ctx: GateContext): GateResult {
  const reasons: GateReason[] = [];
  if (ctx.settings.disclaimerAcceptedVersion !== ctx.disclaimerVersion) reasons.push('disclaimer');
  if (ctx.settings.trainingLock.locked) reasons.push('training-locked');
  if (!ctx.settings.activeCalibrationId) reasons.push('no-calibration');

  const stable = stableCoreSessions(ctx.sessions, ctx.checks);
  const distinctDays = new Set(stable.map((s) => s.day)).size;
  const req = MODULE_GATES[moduleId];

  if (req !== 'none') {
    if (stable.length < STABLE_SESSIONS_REQUIRED) reasons.push('needs-stable-sessions');
    if (distinctDays < STABLE_DISTINCT_DAYS_REQUIRED) reasons.push('needs-distinct-days');
    const recent = [...ctx.sessions]
      .filter((s) => s.status !== 'in-progress')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, RECENT_SESSIONS_WITHOUT_STOP);
    if (recent.some((s) => s.events.some((e) => e.type === 'stop'))) reasons.push('recent-stop');
  }
  if (req === 'stable-and-clinician' && !ctx.settings.clinicianAgreement) reasons.push('clinician-agreement');
  if (ctx.calibrationQuality === 'quick' && NEEDS_FULL_CALIBRATION.has(moduleId))
    reasons.push('needs-full-calibration');

  return {
    unlocked: reasons.length === 0,
    reasons,
    stableSessions: stable.length,
    distinctDays,
    needed: STABLE_SESSIONS_REQUIRED,
    neededDays: STABLE_DISTINCT_DAYS_REQUIRED,
  };
}

/** Offset-reduction (removing virtual prism compensation) requires clinician agreement. */
export function offsetReductionAllowed(
  settings: Pick<Settings, 'clinicianAgreement' | 'progressionLock'>,
): boolean {
  return settings.clinicianAgreement && !settings.progressionLock.locked;
}
