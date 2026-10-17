/**
 * Cloud sync switches that do NOT load the Supabase library: the app makes no network
 * request at all unless sync is configured at build time and the user has signed in.
 */

export const syncConfigured: boolean =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Supabase keeps the signed-in session in localStorage under sb-<project>-auth-token. */
export function hasStoredSession(): boolean {
  if (!syncConfigured || typeof localStorage === 'undefined') return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Sync in the background if the user is signed in and this device holds the sync key
 * (after a session, and when the app starts). Failures are quiet: the Account page shows
 * the state, and the next sync tries again.
 */
export async function autoSync(): Promise<void> {
  if (!hasStoredSession()) return;
  try {
    const service = await import('./service');
    await service.syncIfReady();
  } catch (e) {
    console.warn('Background sync did not complete', e);
  }
}
