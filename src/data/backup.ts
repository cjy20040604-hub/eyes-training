import { getDb } from './db';
import { exportJson } from './exportImport';
import type { SessionRecord, Settings } from './schema';
import { useSettings } from './settingsStore';
import { dayKey } from './util';

/**
 * Keeping the data safe on a device-only app:
 *  - ask the browser to keep the data (persistent storage), so it is not cleared to save
 *    space or, in Safari, after a week without visits;
 *  - remind about backups;
 *  - optionally write a backup file to a folder the user chose (File System Access API,
 *    Chrome / Edge on desktop). Nothing is uploaded anywhere.
 */

export type PersistResult = 'granted' | 'denied' | 'unsupported';

export async function storagePersisted(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export async function requestPersistentStorage(): Promise<PersistResult> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

const DAY_MS = 86_400_000;

/** Whole days since the last backup, or null if there has never been one. */
export function daysSinceBackup(backup: Settings['backup'], now = new Date()): number | null {
  if (!backup.lastBackupAt) return null;
  return Math.floor((now.getTime() - new Date(backup.lastBackupAt).getTime()) / DAY_MS);
}

/**
 * A backup reminder is due when there is something worth keeping (3+ finished sessions)
 * that the last backup does not cover, and the last backup is older than the reminder
 * interval (or there was none).
 */
export function backupDue(backup: Settings['backup'], sessions: SessionRecord[], now = new Date()): boolean {
  const finished = sessions.filter((s) => s.status !== 'in-progress');
  if (finished.length < 3) return false;
  const last = backup.lastBackupAt;
  const newer = last ? finished.filter((s) => (s.endedAt ?? s.startedAt) > last) : finished;
  if (newer.length === 0) return false;
  const days = daysSinceBackup(backup, now);
  return days === null || days >= backup.remindAfterDays;
}

export function backupFileName(date = new Date(), encrypted = false): string {
  return `eyes-training-backup-${dayKey(date)}.${encrypted ? 'bvx' : 'json'}`;
}

// ---- Backup folder (File System Access API) ----

interface PermissionCapableHandle {
  name: string;
  queryPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (opts: { id?: string; mode?: 'readwrite' }) => Promise<PermissionCapableHandle>;
};

const FOLDER_KEY = 'backup-folder';

export function folderBackupSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

export async function chooseBackupFolder(): Promise<string | null> {
  const w = window as PickerWindow;
  if (!w.showDirectoryPicker) return null;
  let handle: PermissionCapableHandle;
  try {
    handle = await w.showDirectoryPicker({ id: 'eyes-training-backup', mode: 'readwrite' });
  } catch {
    return null; // the user cancelled the picker
  }
  await getDb().fileHandles.put({ key: FOLDER_KEY, handle });
  useSettings.getState().setAutoBackup(true);
  return handle.name;
}

export async function backupFolderName(): Promise<string | null> {
  const row = await getDb().fileHandles.get(FOLDER_KEY);
  return (row?.handle as PermissionCapableHandle | undefined)?.name ?? null;
}

export async function forgetBackupFolder(): Promise<void> {
  await getDb().fileHandles.delete(FOLDER_KEY);
  useSettings.getState().setAutoBackup(false);
}

export type FolderBackupResult = 'written' | 'needs-permission' | 'no-folder' | 'off' | 'failed';

/**
 * Write today's backup file into the chosen folder. Browsers forget the permission between
 * visits; `interactive` (a user click) may ask for it again, otherwise we report it.
 */
export async function backupToFolder(interactive = false): Promise<FolderBackupResult> {
  const settings = useSettings.getState();
  if (!settings.backup.autoBackup && !interactive) return 'off';
  const row = await getDb().fileHandles.get(FOLDER_KEY);
  const handle = row?.handle as PermissionCapableHandle | undefined;
  if (!handle) return 'no-folder';
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && interactive) perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return 'needs-permission';
    const file = await handle.getFileHandle(backupFileName(), { create: true });
    const writable = await file.createWritable();
    await writable.write(await exportJson());
    await writable.close();
    settings.markBackup('auto');
    return 'written';
  } catch {
    return 'failed';
  }
}
