import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests, ensureSchemaVersion, getDb } from '../../src/data/db';
import { exportJson, importJson } from '../../src/data/exportImport';
import { migrateSettings } from '../../src/data/migrations';
import {
  SCHEMA_VERSION,
  calibrationProfileSchema,
  defaultSettings,
  exportBundleSchema,
} from '../../src/data/schema';
import { csvCell, sanitizeText } from '../../src/data/sanitize';
import { useSettings } from '../../src/data/settingsStore';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

describe('settings migrations', () => {
  it('migrates from version 0 (nothing stored) to the current schema with defaults', () => {
    const s = migrateSettings({}, 0);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.caps).toEqual(defaultSettings().caps);
  });

  it('keeps known fields and fills missing nested defaults', () => {
    const s = migrateSettings({ locale: 'zh-Hans', caps: { dailyCapMinutes: 20 } }, 0);
    expect(s.locale).toBe('zh-Hans');
    expect(s.caps.dailyCapMinutes).toBe(20);
    expect(s.caps.sessionMaxMinutes).toBe(defaultSettings().caps.sessionMaxMinutes);
  });

  it('falls back to defaults on garbage', () => {
    const s = migrateSettings('nonsense', 0);
    expect(s).toEqual(defaultSettings());
  });
});

describe('IndexedDB round trip', () => {
  beforeEach(() => {
    resetDbForTests();
    useSettings.getState().resetAll();
  });

  it('stores the schema version in meta', async () => {
    expect(await ensureSchemaVersion()).toBe(SCHEMA_VERSION);
    expect((await getDb().meta.get('schemaVersion'))?.value).toBe(SCHEMA_VERSION);
  });

  it('export -> import round-trips calibrations, sessions, checks and settings', async () => {
    const db = getDb();
    const cal = makeCalibration();
    const check = makeCheck();
    const session = makeSession({ calibrationId: cal.id, postCheckId: check.id, notes: 'hello' });
    await db.calibrations.put(cal);
    await db.symptomChecks.put(check);
    await db.sessions.put(session);
    useSettings.getState().setActiveCalibration(cal.id);
    useSettings.getState().updateCaps({ dailyCapMinutes: 25 });

    const json = await exportJson();
    const bundle = exportBundleSchema.parse(JSON.parse(json));
    expect(bundle.schemaVersion).toBe(SCHEMA_VERSION);
    expect(bundle.sessions).toHaveLength(1);

    resetDbForTests();
    useSettings.getState().resetAll();
    const result = await importJson(json, 'replace');
    expect(result).toMatchObject({ calibrations: 1, sessions: 1, symptomChecks: 1, skipped: 0 });
    const back = await getDb().sessions.get(session.id);
    expect(back?.notes).toBe('hello');
    expect(calibrationProfileSchema.parse(await getDb().calibrations.get(cal.id))).toEqual(cal);
    expect(useSettings.getState().caps.dailyCapMinutes).toBe(25);
    expect(useSettings.getState().activeCalibrationId).toBe(cal.id);
  });

  it('skips invalid rows and refuses newer schema versions', async () => {
    const good = makeSession();
    const json = JSON.stringify({
      app: 'eyes-training',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: {},
      calibrations: [{ id: 'bad' }],
      sessions: [good, { id: 'nope' }],
      symptomChecks: [],
      safetyEvents: [],
    });
    const r = await importJson(json, 'merge');
    expect(r.sessions).toBe(1);
    expect(r.skipped).toBe(2);
    await expect(
      importJson(
        json.replace(`"schemaVersion":${SCHEMA_VERSION}`, `"schemaVersion":${SCHEMA_VERSION + 5}`),
        'merge',
      ),
    ).rejects.toThrow();
  });

  it('never imports a released training lock over an active one', async () => {
    useSettings.getState().setTrainingLock(true, 'red flag');
    const json = JSON.stringify({
      app: 'eyes-training',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: { ...defaultSettings(), trainingLock: { locked: false, reason: '', since: null } },
      calibrations: [],
      sessions: [],
      symptomChecks: [],
      safetyEvents: [],
    });
    await importJson(json, 'replace');
    expect(useSettings.getState().trainingLock.locked).toBe(true);
  });
});

describe('sanitisation', () => {
  it('strips control characters and caps length', () => {
    expect(sanitizeText('a\u0000b\u001Fc‮d')).toBe('abcd');
    expect(sanitizeText('x'.repeat(5000)).length).toBe(2000);
    expect(sanitizeText(42)).toBe('');
  });
  it('neutralises CSV formula injection and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
