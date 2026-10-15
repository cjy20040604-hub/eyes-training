import { getDb } from './db';
import {
  SCHEMA_VERSION,
  calibrationProfileSchema,
  exportBundleSchema,
  safetyEventSchema,
  sessionRecordSchema,
  settingsSchema,
  symptomCheckSchema,
  type CalibrationProfile,
  type ExportBundle,
  type SafetyEvent,
  type SessionRecord,
  type Settings,
  type SymptomCheck,
} from './schema';
import { migrateSettings } from './migrations';
import { csvCell, sanitizeText } from './sanitize';
import { useSettings } from './settingsStore';
import { nowIso } from './util';

function settingsData(): Settings {
  const s = useSettings.getState();
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') data[k] = v;
  return settingsSchema.parse(data);
}

export async function buildExportBundle(): Promise<ExportBundle> {
  const db = getDb();
  const [calibrations, sessions, symptomChecks, safetyEvents] = await Promise.all([
    db.calibrations.toArray(),
    db.sessions.toArray(),
    db.symptomChecks.toArray(),
    db.safetyEvents.toArray(),
  ]);
  return {
    app: 'eyes-training',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    settings: settingsData(),
    calibrations,
    sessions,
    symptomChecks,
    safetyEvents,
  };
}

export async function exportJson(): Promise<string> {
  return JSON.stringify(await buildExportBundle(), null, 2);
}

export interface ImportResult {
  calibrations: number;
  sessions: number;
  symptomChecks: number;
  safetyEvents: number;
  skipped: number;
}

/**
 * Import a bundle. `mode` 'merge' keeps existing rows and adds/overwrites by id;
 * 'replace' clears local data first. Invalid rows are skipped, not fatal.
 */
export async function importJson(json: string, mode: 'merge' | 'replace' = 'merge'): Promise<ImportResult> {
  const parsed = exportBundleSchema.parse(JSON.parse(json));
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Bundle schema ${parsed.schemaVersion} is newer than this app (${SCHEMA_VERSION})`);
  }
  const db = getDb();
  let skipped = 0;
  const calibrations: CalibrationProfile[] = [];
  for (const raw of parsed.calibrations) {
    const r = calibrationProfileSchema.safeParse(raw);
    if (r.success) calibrations.push({ ...r.data, postureNote: sanitizeText(r.data.postureNote) });
    else skipped++;
  }
  const sessions: SessionRecord[] = [];
  for (const raw of parsed.sessions) {
    const r = sessionRecordSchema.safeParse(raw);
    if (r.success)
      sessions.push({
        ...r.data,
        notes: sanitizeText(r.data.notes),
        postureNote: sanitizeText(r.data.postureNote),
      });
    else skipped++;
  }
  const checks: SymptomCheck[] = [];
  for (const raw of parsed.symptomChecks) {
    const r = symptomCheckSchema.safeParse(raw);
    if (r.success) checks.push({ ...r.data, notes: sanitizeText(r.data.notes) });
    else skipped++;
  }
  const events: SafetyEvent[] = [];
  for (const raw of parsed.safetyEvents) {
    const r = safetyEventSchema.safeParse(raw);
    if (r.success) events.push({ ...r.data, details: sanitizeText(r.data.details) });
    else skipped++;
  }

  await db.transaction('rw', db.calibrations, db.sessions, db.symptomChecks, db.safetyEvents, async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.calibrations.clear(),
        db.sessions.clear(),
        db.symptomChecks.clear(),
        db.safetyEvents.clear(),
      ]);
    }
    await db.calibrations.bulkPut(calibrations);
    await db.sessions.bulkPut(sessions);
    await db.symptomChecks.bulkPut(checks);
    await db.safetyEvents.bulkPut(events);
  });

  if (parsed.settings && typeof parsed.settings === 'object') {
    const migrated = migrateSettings(parsed.settings, parsed.schemaVersion);
    // Never import a lock release: keep the stricter of the two lock states.
    const current = useSettings.getState();
    migrated.trainingLock = current.trainingLock.locked ? current.trainingLock : migrated.trainingLock;
    migrated.progressionLock = current.progressionLock.locked
      ? current.progressionLock
      : migrated.progressionLock;
    migrated.clinicianNotes = sanitizeText(migrated.clinicianNotes);
    if (mode === 'replace') current.replaceAll(migrated);
    else
      current.replaceAll({
        ...migrated,
        disclaimerAcceptedVersion: current.disclaimerAcceptedVersion,
        disclaimerAcceptedAt: current.disclaimerAcceptedAt,
      });
  }

  return {
    calibrations: calibrations.length,
    sessions: sessions.length,
    symptomChecks: checks.length,
    safetyEvents: events.length,
    skipped,
  };
}

export function sessionsToCsv(sessions: SessionRecord[], checks: SymptomCheck[]): string {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const header = [
    'id',
    'module',
    'day',
    'startedAt',
    'endedAt',
    'status',
    'plannedMinutes',
    'actualMinutes',
    'intensityTier',
    'intensityMetric',
    'intensityValue',
    'gameDifficulty',
    'viewingDistanceCm',
    'preDiplopia',
    'postDiplopia',
    'postHeadache',
    'postEyestrain',
    'stopEvents',
    'notes',
    'measurements',
  ];
  const rows = sessions.map((s) => {
    const pre = s.preCheckId ? byId.get(s.preCheckId) : undefined;
    const post = s.postCheckId ? byId.get(s.postCheckId) : undefined;
    return [
      s.id,
      s.moduleId,
      s.day,
      s.startedAt,
      s.endedAt ?? '',
      s.status,
      s.plannedMinutes,
      s.actualMinutes.toFixed(2),
      s.intensityTier,
      s.intensityMetric,
      s.intensityValue,
      s.gameDifficulty,
      s.viewingDistanceCm,
      pre?.diplopia ?? '',
      post?.diplopia ?? '',
      post?.headache ?? '',
      post?.eyestrain ?? '',
      s.events.filter((e) => e.type === 'stop').length,
      s.notes,
      Object.entries(s.metrics)
        .filter(([k]) => k !== 'lastHeartbeatMs')
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

export function symptomsToCsv(checks: SymptomCheck[]): string {
  const header = [
    'at',
    'phase',
    'sessionId',
    'diplopia',
    'headache',
    'nausea',
    'eyestrain',
    'confusion',
    'notes',
  ];
  const rows = [...checks]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) =>
      [c.at, c.phase, c.sessionId ?? '', c.diplopia, c.headache, c.nausea, c.eyestrain, c.confusion, c.notes]
        .map(csvCell)
        .join(','),
    );
  return [header.join(','), ...rows].join('\n');
}

export function safetyEventsToCsv(events: SafetyEvent[]): string {
  const header = ['at', 'type', 'sessionId', 'details'];
  const rows = [...events]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => [e.at, e.type, e.sessionId ?? '', e.details].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
