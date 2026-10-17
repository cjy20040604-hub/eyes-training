import { rememberedKey, syncNow, type SyncResult } from './engine';
import { currentSession, supabaseBackend } from './supabase';

/** Sync now if signed in and this device remembers the sync key; otherwise do nothing. */
export async function syncIfReady(): Promise<SyncResult | null> {
  const session = await currentSession();
  if (!session) return null;
  const key = await rememberedKey(session.user.id);
  if (!key) return null;
  return syncNow(supabaseBackend(session.user.id), key, session.user.id);
}
