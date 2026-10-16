import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupDue,
  backupFileName,
  backupToFolder,
  chooseBackupFolder,
  daysSinceBackup,
  forgetBackupFolder,
  requestPersistentStorage,
} from '../../src/data/backup';
import {
  ENCRYPTED_FORMAT,
  WrongPassphraseError,
  decryptText,
  encryptText,
  isEncryptedBackup,
  parseEnvelope,
} from '../../src/data/crypto';
import { getDb, resetDbForTests } from '../../src/data/db';
import { migrateSettings } from '../../src/data/migrations';
import { SCHEMA_VERSION, defaultSettings } from '../../src/data/schema';
import { useSettings } from '../../src/data/settingsStore';
import { makeSession } from '../fixtures/factories';

const FAST = 2000; // fewer PBKDF2 rounds keep the tests quick; the app uses 600 000

describe('encrypted backups', () => {
  it('round-trips text with the right passphrase', async () => {
    const plain = JSON.stringify({ app: 'eyes-training', notes: '双眼 ✓' });
    const enc = await encryptText(plain, 'correct horse', FAST);
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(enc).not.toContain('eyes-training"'); // the payload is not readable
    expect(await decryptText(enc, 'correct horse')).toBe(plain);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = parseEnvelope(await encryptText('same', 'passphrase', FAST))!;
    const b = parseEnvelope(await encryptText('same', 'passphrase', FAST))!;
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect(a).toMatchObject({
      format: ENCRYPTED_FORMAT,
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256' },
    });
  });

  it('rejects a wrong passphrase and a modified file', async () => {
    const enc = await encryptText('secret', 'passphrase', FAST);
    await expect(decryptText(enc, 'Passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    const env = parseEnvelope(enc)!;
    const flipped = env.data.startsWith('A') ? `B${env.data.slice(1)}` : `A${env.data.slice(1)}`;
    await expect(decryptText(JSON.stringify({ ...env, data: flipped }), 'passphrase')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('refuses short passphrases and recognises only real envelopes', async () => {
    await expect(encryptText('x', 'short', FAST)).rejects.toThrow();
    expect(isEncryptedBackup('{"app":"eyes-training"}')).toBe(false);
    expect(isEncryptedBackup('not json')).toBe(false);
    expect(
      parseEnvelope(JSON.stringify({ format: ENCRYPTED_FORMAT, version: 1, kdf: { iterations: 10 } })),
    ).toBeNull();
  });
});

describe('backup reminders', () => {
  const backup = (over: Partial<ReturnType<typeof defaultSettings>['backup']> = {}) => ({
    ...defaultSettings().backup,
    ...over,
  });
  const done = (endedAt: string) => makeSession({ status: 'completed', endedAt, startedAt: endedAt });

  it('is quiet until there is something worth keeping', () => {
    expect(backupDue(backup(), [done('2026-10-01T10:00:00Z'), done('2026-10-02T10:00:00Z')])).toBe(false);
    expect(
      backupDue(
        backup(),
        [1, 2, 3].map((d) => done(`2026-10-0${d}T10:00:00Z`)),
      ),
    ).toBe(true);
  });

  it('reminds again only after the interval, and only for sessions the backup misses', () => {
    const sessions = [1, 2, 3].map((d) => done(`2026-10-0${d}T10:00:00Z`));
    const now = new Date('2026-10-12T10:00:00Z');
    expect(backupDue(backup({ lastBackupAt: '2026-10-04T10:00:00Z' }), sessions, now)).toBe(false);
    const more = [...sessions, done('2026-10-06T10:00:00Z')];
    expect(backupDue(backup({ lastBackupAt: '2026-10-04T10:00:00Z' }), more, now)).toBe(true);
    expect(backupDue(backup({ lastBackupAt: '2026-10-10T10:00:00Z' }), more, now)).toBe(false);
    expect(daysSinceBackup(backup({ lastBackupAt: '2026-10-04T10:00:00Z' }), now)).toBe(8);
    expect(daysSinceBackup(backup())).toBeNull();
  });

  it('names backup files by date and kind', () => {
    const d = new Date(2026, 9, 16);
    expect(backupFileName(d)).toBe('eyes-training-backup-2026-10-16.json');
    expect(backupFileName(d, true)).toBe('eyes-training-backup-2026-10-16.bvx');
  });
});

describe('persistent storage', () => {
  it('asks the browser once and reports the answer', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: async () => false, persist } });
    expect(await requestPersistentStorage()).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: async () => true, persist } });
    expect(await requestPersistentStorage()).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    expect(await requestPersistentStorage()).toBe('unsupported');
    vi.unstubAllGlobals();
  });
});

describe('backup folder', () => {
  beforeEach(() => {
    const db = resetDbForTests();
    useSettings.getState().resetAll();
    // Real directory handles can be stored in IndexedDB; this fake one (with functions) cannot,
    // so keep it in memory instead.
    const mem = new Map<string, { key: string; handle: unknown }>();
    vi.spyOn(db.fileHandles, 'put').mockImplementation((async (row: { key: string; handle: unknown }) => {
      mem.set(row.key, row);
      return row.key;
    }) as never);
    vi.spyOn(db.fileHandles, 'get').mockImplementation((async (key: string) => mem.get(key)) as never);
    vi.spyOn(db.fileHandles, 'delete').mockImplementation((async (key: string) => {
      mem.delete(key);
    }) as never);
    vi.spyOn(db.fileHandles, 'count').mockImplementation((async () => mem.size) as never);
  });

  function fakeFolder(permission: PermissionState) {
    const written: Record<string, string> = {};
    let perm = permission;
    const handle = {
      name: 'Backups',
      queryPermission: vi.fn(async () => perm),
      requestPermission: vi.fn(async () => {
        perm = 'granted';
        return perm;
      }),
      getFileHandle: vi.fn(async (name: string) => ({
        createWritable: async () => ({
          write: async (data: string) => {
            written[name] = data;
          },
          close: async () => {},
        }),
      })),
    };
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => handle);
    return { handle, written };
  }

  it('remembers the chosen folder and writes the backup into it', async () => {
    const { written } = fakeFolder('granted');
    expect(await chooseBackupFolder()).toBe('Backups');
    expect(useSettings.getState().backup.autoBackup).toBe(true);
    expect(await backupToFolder()).toBe('written');
    const [name] = Object.keys(written);
    expect(name).toMatch(/^eyes-training-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(written[name!]!).app).toBe('eyes-training');
    expect(useSettings.getState().backup.lastAutoBackupAt).not.toBeNull();
  });

  it('asks for permission again only when the user clicks', async () => {
    const { handle } = fakeFolder('prompt');
    await chooseBackupFolder();
    expect(await backupToFolder()).toBe('needs-permission');
    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(await backupToFolder(true)).toBe('written');
  });

  it('does nothing when switched off or forgotten', async () => {
    fakeFolder('granted');
    expect(await backupToFolder()).toBe('off');
    await chooseBackupFolder();
    await forgetBackupFolder();
    expect(await getDb().fileHandles.count()).toBe(0);
    expect(await backupToFolder(true)).toBe('no-folder');
  });
});

describe('settings migration to schema 2', () => {
  it('adds the new fields and keeps existing choices', () => {
    expect(SCHEMA_VERSION).toBe(2);
    const v1 = {
      locale: 'zh-Hans',
      dailyPlan: { l1: { minutes: 6, intensityTier: 'medium', enabled: true } },
      caps: { dailyCapMinutes: 25 },
    };
    const s = migrateSettings(v1, 1);
    expect(s.locale).toBe('zh-Hans');
    expect(s.dailyPlan.l1).toEqual({ minutes: 6, intensityTier: 'medium', enabled: true });
    expect(s.dailyPlan.brock?.enabled).toBe(false);
    expect(s.dailyPlan.reading?.enabled).toBe(false);
    expect(s.weeklyGoalDays).toBe(4);
    expect(s.backup).toEqual(defaultSettings().backup);
    expect(s.vrComfortAcknowledgedAt).toBeNull();
  });

  it('weekly goal and reminder setters stay inside their limits', () => {
    const st = useSettings.getState();
    st.setWeeklyGoalDays(12);
    expect(useSettings.getState().weeklyGoalDays).toBe(7);
    st.setReminder({ weekdays: [5, 1, 1, 9], time: '25:00' });
    expect(useSettings.getState().reminder).toEqual({ weekdays: [1, 5], time: '19:00' });
    st.setReminder({ time: '07:30' });
    expect(useSettings.getState().reminder.time).toBe('07:30');
  });
});
