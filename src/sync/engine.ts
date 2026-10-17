import {
  DEFAULT_ITERATIONS,
  deriveSyncKey,
  openWithKey,
  randomSaltBase64,
  sealWithKey,
} from '../data/crypto';
import { getDb } from '../data/db';
import { buildExportBundle, importJson } from '../data/exportImport';
import { exportBundleSchema, type ExportBundle } from '../data/schema';
import { mergeBundles } from './merge';

/**
 * End-to-end encrypted sync.
 *
 * The cloud keeps ONE encrypted "vault" per account: the whole data bundle, gzip-compressed
 * and sealed with AES-256-GCM under a key derived (PBKDF2-SHA-256, 600 000 rounds) from a
 * sync passphrase that never leaves the device. The server only ever sees ciphertext, a
 * random salt and a version number, so neither the server operator nor anyone with database
 * access can read the training data.
 *
 * A sync: download the vault, decrypt, merge with this device (merge.ts), save locally, then
 * upload the merged result with `version + 1` — accepted only if nobody else uploaded in
 * between (optimistic concurrency); otherwise start again (up to 3 times).
 */

export interface VaultRow {
  version: number;
  salt: string;
  iterations: number;
  iv: string;
  data: string;
  device: string;
  updatedAt?: string;
}

/** Where the vault lives (Supabase in the app; an in-memory fake in tests). */
export interface SyncBackend {
  getVault(): Promise<VaultRow | null>;
  /** 'exists' when another device created the vault first. */
  createVault(row: VaultRow): Promise<'ok' | 'exists'>;
  /** 'conflict' when the stored version is no longer `expectedVersion`. */
  updateVault(row: VaultRow, expectedVersion: number): Promise<'ok' | 'conflict'>;
  deleteVault(): Promise<void>;
}

export class WrongSyncPassphraseError extends Error {
  constructor() {
    super('Wrong sync passphrase.');
    this.name = 'WrongSyncPassphraseError';
  }
}

export interface SyncKey {
  key: CryptoKey;
  salt: string;
  iterations: number;
}

export interface SyncResult {
  version: number;
  created: boolean;
  /** Records that came from the cloud and were new or newer on this device. */
  received: { sessions: number; symptomChecks: number; assessments: number; calibrations: number };
}

const KEY_ROW = 'sync-key';
const STATE_ROW = 'sync-state';

export interface SyncState {
  lastSyncedAt: string | null;
  version: number | null;
  userId: string | null;
}

export async function loadSyncState(): Promise<SyncState> {
  const row = await getDb().meta.get(STATE_ROW);
  try {
    if (row && typeof row.value === 'string') return JSON.parse(row.value) as SyncState;
  } catch {
    // fall through
  }
  return { lastSyncedAt: null, version: null, userId: null };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await getDb().meta.put({ key: STATE_ROW, value: JSON.stringify(state) });
}

/** Keep the (non-extractable) key on this device so later syncs need no passphrase. */
export async function rememberKey(userId: string, k: SyncKey): Promise<void> {
  await getDb().fileHandles.put({ key: `${KEY_ROW}:${userId}`, handle: k });
}

export async function rememberedKey(userId: string): Promise<SyncKey | null> {
  const row = await getDb().fileHandles.get(`${KEY_ROW}:${userId}`);
  return (row?.handle as SyncKey | undefined) ?? null;
}

export async function forgetKey(userId: string): Promise<void> {
  await getDb().fileHandles.delete(`${KEY_ROW}:${userId}`);
}

/** First device: a new random salt for this account's vault. */
export async function newSyncKey(passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<SyncKey> {
  const salt = randomSaltBase64();
  return { key: await deriveSyncKey(passphrase, salt, iterations), salt, iterations };
}

/** Another device: derive the key from the vault's salt and check it opens the vault. */
export async function unlockVault(backend: SyncBackend, passphrase: string): Promise<SyncKey | null> {
  const vault = await backend.getVault();
  if (!vault) return null;
  const k = {
    key: await deriveSyncKey(passphrase, vault.salt, vault.iterations),
    salt: vault.salt,
    iterations: vault.iterations,
  };
  try {
    await openWithKey(k.key, vault);
  } catch {
    throw new WrongSyncPassphraseError();
  }
  return k;
}

async function decryptVault(k: SyncKey, vault: VaultRow): Promise<ExportBundle> {
  let text: string;
  try {
    text = await openWithKey(k.key, vault);
  } catch {
    throw new WrongSyncPassphraseError();
  }
  return exportBundleSchema.parse(JSON.parse(text));
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

const count = (b: ExportBundle, key: 'sessions' | 'symptomChecks' | 'assessments' | 'calibrations') =>
  (b[key] ?? []).length;

export async function syncNow(backend: SyncBackend, k: SyncKey, userId: string): Promise<SyncResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = await buildExportBundle();
    const remote = await backend.getVault();
    if (!remote) {
      const sealed = await sealWithKey(k.key, JSON.stringify(local));
      const res = await backend.createVault({
        version: 1,
        salt: k.salt,
        iterations: k.iterations,
        ...sealed,
        device: deviceLabel(),
      });
      if (res === 'exists') continue;
      await saveSyncState({ lastSyncedAt: new Date().toISOString(), version: 1, userId });
      return {
        version: 1,
        created: true,
        received: { sessions: 0, symptomChecks: 0, assessments: 0, calibrations: 0 },
      };
    }
    if (remote.salt !== k.salt) throw new WrongSyncPassphraseError();
    const remoteBundle = await decryptVault(k, remote);
    const merged = mergeBundles(local, remoteBundle);
    await importJson(JSON.stringify(merged), 'merge');
    const after = await buildExportBundle();
    const sealed = await sealWithKey(k.key, JSON.stringify(after));
    const version = remote.version + 1;
    const res = await backend.updateVault(
      { version, salt: k.salt, iterations: k.iterations, ...sealed, device: deviceLabel() },
      remote.version,
    );
    if (res === 'conflict') continue;
    await saveSyncState({ lastSyncedAt: new Date().toISOString(), version, userId });
    return {
      version,
      created: false,
      received: {
        sessions: Math.max(0, count(after, 'sessions') - count(local, 'sessions')),
        symptomChecks: Math.max(0, count(after, 'symptomChecks') - count(local, 'symptomChecks')),
        assessments: Math.max(0, count(after, 'assessments') - count(local, 'assessments')),
        calibrations: Math.max(0, count(after, 'calibrations') - count(local, 'calibrations')),
      },
    };
  }
  throw new Error('Another device kept syncing at the same time. Try again in a moment.');
}
