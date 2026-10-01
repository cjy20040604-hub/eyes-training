import Dexie, { type Table } from 'dexie';
import type { CalibrationProfile, SafetyEvent, SessionRecord, SymptomCheck } from './schema';
import { SCHEMA_VERSION } from './schema';

export interface MetaRow {
  key: string;
  value: string | number;
}

/**
 * IndexedDB via Dexie. Everything stays on this device. Dexie's version() chain is the
 * migration mechanism: add a new version() with an upgrade() when SCHEMA_VERSION bumps.
 */
export class AppDatabase extends Dexie {
  calibrations!: Table<CalibrationProfile, string>;
  sessions!: Table<SessionRecord, string>;
  symptomChecks!: Table<SymptomCheck, string>;
  safetyEvents!: Table<SafetyEvent, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'eyes-training') {
    super(name);
    this.version(1).stores({
      calibrations: 'id, createdAt',
      sessions: 'id, moduleId, day, startedAt, status',
      symptomChecks: 'id, sessionId, phase, at',
      safetyEvents: 'id, type, at',
      meta: 'key',
    });
  }
}

let instance: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (!instance) instance = new AppDatabase();
  return instance;
}

/** For tests: swap in a fresh database. */
export function resetDbForTests(name = `eyes-training-test-${Date.now()}`): AppDatabase {
  instance = new AppDatabase(name);
  return instance;
}

export async function ensureSchemaVersion(db: AppDatabase = getDb()): Promise<number> {
  const row = await db.meta.get('schemaVersion');
  if (!row) {
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    return SCHEMA_VERSION;
  }
  return Number(row.value);
}

export async function listSessionsForDay(day: string, db: AppDatabase = getDb()): Promise<SessionRecord[]> {
  return db.sessions.where('day').equals(day).toArray();
}

export async function listRecentSessions(limit = 200, db: AppDatabase = getDb()): Promise<SessionRecord[]> {
  return db.sessions.orderBy('startedAt').reverse().limit(limit).toArray();
}

export async function listPostChecks(limit = 100, db: AppDatabase = getDb()): Promise<SymptomCheck[]> {
  const all = await db.symptomChecks
    .orderBy('at')
    .reverse()
    .limit(limit * 3)
    .toArray();
  return all.filter((c) => c.phase === 'post').slice(0, limit);
}

export async function findInProgressSession(db: AppDatabase = getDb()): Promise<SessionRecord | undefined> {
  return db.sessions.where('status').equals('in-progress').first();
}
