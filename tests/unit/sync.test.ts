import { beforeEach, describe, expect, it } from 'vitest';
import { openWithKey, sealWithKey } from '../../src/data/crypto';
import { getDb, resetDbForTests } from '../../src/data/db';
import { buildExportBundle } from '../../src/data/exportImport';
import type { ExportBundle } from '../../src/data/schema';
import { useSettings } from '../../src/data/settingsStore';
import {
  WrongSyncPassphraseError,
  forgetKey,
  loadSyncState,
  newSyncKey,
  rememberKey,
  rememberedKey,
  syncNow,
  unlockVault,
  type SyncBackend,
  type VaultRow,
} from '../../src/sync/engine';
import { mergeBundles } from '../../src/sync/merge';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

const FAST = 2000; // fewer PBKDF2 rounds in tests; the app uses 600 000

/** An in-memory stand-in for the Supabase vault table, with optimistic versioning. */
function memoryBackend() {
  let vault: VaultRow | null = null;
  let conflictsToInject = 0;
  const backend: SyncBackend & { peek(): VaultRow | null; injectConflict(n: number): void } = {
    async getVault() {
      return vault ? { ...vault } : null;
    },
    async createVault(row) {
      if (vault) return 'exists';
      vault = { ...row };
      return 'ok';
    },
    async updateVault(row, expected) {
      if (conflictsToInject > 0) {
        conflictsToInject--;
        // Another device uploads in between.
        vault = { ...vault!, version: vault!.version + 1 };
        return 'conflict';
      }
      if (!vault || vault.version !== expected) return 'conflict';
      vault = { ...row };
      return 'ok';
    },
    async deleteVault() {
      vault = null;
    },
    peek: () => vault,
    injectConflict: (n) => {
      conflictsToInject = n;
    },
  };
  return backend;
}

/** Switch to a "device": its own local database and settings. */
function device(name: string) {
  resetDbForTests(`sync-test-${name}-${Math.random()}`);
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
}

beforeEach(() => device('a'));

describe('sealed vault data', () => {
  it('compresses and encrypts; only the right key opens it', async () => {
    const k = await newSyncKey('a long sync passphrase', FAST);
    const text = JSON.stringify({ hello: '双眼'.repeat(500) });
    const sealed = await sealWithKey(k.key, text);
    expect(sealed.data.length).toBeLessThan(text.length); // gzip before encryption
    expect(await openWithKey(k.key, sealed)).toBe(text);
    const other = await newSyncKey('a long sync passphrase', FAST); // same passphrase, other salt
    await expect(openWithKey(other.key, sealed)).rejects.toThrow();
  });
});

describe('sync between devices', () => {
  it('first device creates the vault; the server only holds ciphertext', async () => {
    const backend = memoryBackend();
    await getDb().sessions.put(makeSession({ id: 'ses_a1', notes: 'private note' }));
    const k = await newSyncKey('a long sync passphrase', FAST);
    const r = await syncNow(backend, k, 'user-1');
    expect(r).toMatchObject({ version: 1, created: true });
    const stored = backend.peek()!;
    expect(stored.data).not.toContain('private note');
    expect(stored.data).not.toContain('ses_a1');
    expect(stored.salt).toBe(k.salt);
    expect((await loadSyncState()).version).toBe(1);
  });

  it('a second device unlocks with the passphrase, receives the data, and both converge', async () => {
    const backend = memoryBackend();
    const pass = 'a long sync passphrase';
    // Device A: one calibration and two sessions.
    await getDb().calibrations.put(makeCalibration({ id: 'cal_a' }));
    await getDb().sessions.bulkPut([makeSession({ id: 's1' }), makeSession({ id: 's2' })]);
    const kA = await newSyncKey(pass, FAST);
    await syncNow(backend, kA, 'user-1');

    // Device B: a session of its own, then unlock with the same passphrase.
    device('b');
    await getDb().sessions.put(makeSession({ id: 's3' }));
    await expect(unlockVault(backend, 'wrong passphrase!!')).rejects.toBeInstanceOf(WrongSyncPassphraseError);
    const kB = (await unlockVault(backend, pass))!;
    const r = await syncNow(backend, kB, 'user-1');
    expect(r.version).toBe(2);
    expect(r.received.sessions).toBe(2);
    expect(r.received.calibrations).toBe(1);
    expect((await getDb().sessions.toArray()).map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);

    // Back on device A: the next sync brings s3.
    device('a2');
    await getDb().sessions.bulkPut([makeSession({ id: 's1' }), makeSession({ id: 's2' })]);
    const r2 = await syncNow(backend, kA, 'user-1');
    expect(r2.version).toBe(3);
    expect((await getDb().sessions.toArray()).map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('retries when another device uploads at the same moment', async () => {
    const backend = memoryBackend();
    const k = await newSyncKey('a long sync passphrase', FAST);
    await syncNow(backend, k, 'user-1');
    backend.injectConflict(1);
    const r = await syncNow(backend, k, 'user-1');
    expect(r.version).toBe(3); // 1 -> (other device) 2 -> ours 3
  });

  it('a key for another vault is refused', async () => {
    const backend = memoryBackend();
    await syncNow(backend, await newSyncKey('first passphrase!!', FAST), 'user-1');
    const other = await newSyncKey('first passphrase!!', FAST);
    await expect(syncNow(backend, other, 'user-1')).rejects.toBeInstanceOf(WrongSyncPassphraseError);
  });

  it('the derived key can be remembered on this device and forgotten', async () => {
    const k = await newSyncKey('a long sync passphrase', FAST);
    await rememberKey('user-1', k);
    const back = await rememberedKey('user-1');
    expect(back?.salt).toBe(k.salt);
    const sealed = await sealWithKey(back!.key, 'hello');
    expect(await openWithKey(k.key, sealed)).toBe('hello');
    await forgetKey('user-1');
    expect(await rememberedKey('user-1')).toBeNull();
  });
});

describe('merge rules', () => {
  const bundle = (over: Partial<ExportBundle>): ExportBundle => ({
    app: 'eyes-training',
    schemaVersion: 2,
    exportedAt: '2026-10-01T00:00:00.000Z',
    settings: {},
    calibrations: [],
    sessions: [],
    symptomChecks: [],
    safetyEvents: [],
    assessments: [],
    ...over,
  });

  it('keeps the more complete copy of a session', () => {
    const running = makeSession({ id: 'x', status: 'in-progress', postCheckId: null });
    const finished = makeSession({ id: 'x', status: 'completed', postCheckId: 'c1' });
    expect(mergeBundles(bundle({ sessions: [running] }), bundle({ sessions: [finished] })).sessions).toEqual([
      finished,
    ]);
    expect(mergeBundles(bundle({ sessions: [finished] }), bundle({ sessions: [running] })).sessions).toEqual([
      finished,
    ]);
  });

  it('takes the newer calibration and the union of everything else', () => {
    const old = makeCalibration({ id: 'c', updatedAt: '2026-10-01T00:00:00Z', name: 'old' });
    const neu = makeCalibration({ id: 'c', updatedAt: '2026-10-05T00:00:00Z', name: 'new' });
    const m = mergeBundles(
      bundle({ calibrations: [old], symptomChecks: [makeCheck({ id: 'k1' })] }),
      bundle({ calibrations: [neu], symptomChecks: [makeCheck({ id: 'k2' })] }),
    );
    expect((m.calibrations[0] as { name: string }).name).toBe('new');
    expect(m.symptomChecks.map((c) => (c as { id: string }).id).sort()).toEqual(['k1', 'k2']);
  });

  it('settings: a new device takes the cloud’s; locks are never lost', () => {
    const lock = { locked: true, reason: 'red flag', since: '2026-10-01T00:00:00Z' };
    const open = { locked: false, reason: '', since: null };
    const fresh = mergeBundles(
      bundle({ settings: { locale: 'en', trainingLock: open } }),
      bundle({ settings: { locale: 'zh-Hans', trainingLock: lock } }),
    );
    expect(fresh.settings).toMatchObject({ locale: 'zh-Hans', trainingLock: lock });
    const used = mergeBundles(
      bundle({ settings: { locale: 'en', trainingLock: open }, sessions: [makeSession()] }),
      bundle({ settings: { locale: 'zh-Hans', trainingLock: lock } }),
    );
    expect(used.settings).toMatchObject({ locale: 'en', trainingLock: lock });
  });

  it('the merged bundle imports cleanly', async () => {
    await getDb().sessions.put(makeSession({ id: 'local' }));
    const local = await buildExportBundle();
    const merged = mergeBundles(local, bundle({ sessions: [makeSession({ id: 'remote' })] }));
    expect(merged.sessions).toHaveLength(2);
  });
});
