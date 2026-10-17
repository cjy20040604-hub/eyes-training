import type { ExportBundle } from '../data/schema';

/**
 * Merging two devices' data (this device and the encrypted copy in the cloud).
 *
 * Records are matched by id. Most records never change after they are written (symptom
 * checks, safety events, weekly self-checks, error logs), so both copies are equal and the
 * union is enough. The ones that do change are resolved without clocks:
 *  - a session: the more complete copy wins (finished over in-progress, then the one with a
 *    post-session check, then more events);
 *  - a calibration profile: the later `updatedAt` wins.
 * Settings: a device that has no training data yet takes the cloud's settings; otherwise
 * it keeps its own. Locks are never lost: if either side is locked, the result is locked.
 */

type Rec = { id: string } & Record<string, unknown>;

const STATUS_RANK: Record<string, number> = {
  'in-progress': 0,
  recovered: 1,
  aborted: 2,
  stopped: 3,
  completed: 3,
};

function sessionScore(s: Rec): [number, number, number] {
  return [
    STATUS_RANK[String(s['status'])] ?? 0,
    s['postCheckId'] ? 1 : 0,
    Array.isArray(s['events']) ? (s['events'] as unknown[]).length : 0,
  ];
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

function mergeById(local: unknown[], remote: unknown[], pickRemote: (l: Rec, r: Rec) => boolean): unknown[] {
  const out = new Map<string, Rec>();
  for (const r of local as Rec[]) if (r && typeof r.id === 'string') out.set(r.id, r);
  for (const r of remote as Rec[]) {
    if (!r || typeof r.id !== 'string') continue;
    const l = out.get(r.id);
    if (!l || pickRemote(l, r)) out.set(r.id, r);
  }
  return [...out.values()];
}

type Lock = { locked: boolean; reason: string; since: string | null };

function stricter(a: Lock | undefined, b: Lock | undefined): Lock | undefined {
  if (a?.locked) return a;
  if (b?.locked) return b;
  return a ?? b;
}

export function hasTrainingData(b: Pick<ExportBundle, 'sessions' | 'calibrations'>): boolean {
  return b.sessions.length > 0 || b.calibrations.length > 0;
}

export function mergeBundles(local: ExportBundle, remote: ExportBundle): ExportBundle {
  const localSettings = (local.settings ?? {}) as Record<string, unknown>;
  const remoteSettings = (remote.settings ?? {}) as Record<string, unknown>;
  const base = hasTrainingData(local) ? localSettings : { ...localSettings, ...remoteSettings };
  const settings = {
    ...base,
    trainingLock: stricter(localSettings['trainingLock'] as Lock, remoteSettings['trainingLock'] as Lock),
    progressionLock: stricter(
      localSettings['progressionLock'] as Lock,
      remoteSettings['progressionLock'] as Lock,
    ),
  };
  const union = (l: unknown[] | undefined, r: unknown[] | undefined) =>
    mergeById(l ?? [], r ?? [], () => false);
  return {
    app: 'eyes-training',
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    exportedAt: new Date().toISOString(),
    settings,
    calibrations: mergeById(
      local.calibrations,
      remote.calibrations,
      (l, r) => String(r['updatedAt'] ?? '') > String(l['updatedAt'] ?? ''),
    ),
    sessions: mergeById(local.sessions, remote.sessions, (l, r) => better(sessionScore(r), sessionScore(l))),
    symptomChecks: union(local.symptomChecks, remote.symptomChecks),
    safetyEvents: union(local.safetyEvents, remote.safetyEvents),
    assessments: union(local.assessments, remote.assessments),
  };
}
