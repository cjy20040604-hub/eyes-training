import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { SyncBackend, VaultRow } from './engine';

/**
 * Supabase: account (email + password) and storage of the encrypted vault.
 * Configured at build time (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY; the anon key is a
 * public key, access is limited by row-level security, see supabase/schema.sql).
 * This module is only loaded when the user opens Account, or when they are signed in.
 */

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Cloud sync is not configured.');
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** For tests: drop the cached client. */
export function resetSupabaseClient(): void {
  client = null;
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  const { data, error } = await supabase().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.href.split('#')[0] },
  });
  if (error) throw error;
  return data.session ? 'signed-in' : 'confirm-email';
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split('#')[0],
  });
  if (error) throw error;
}

interface VaultDbRow {
  user_id: string;
  version: number;
  salt: string;
  iterations: number;
  iv: string;
  data: string;
  device: string;
  updated_at?: string;
}

const toRow = (r: VaultDbRow): VaultRow => ({
  version: Number(r.version),
  salt: r.salt,
  iterations: Number(r.iterations),
  iv: r.iv,
  data: r.data,
  device: r.device,
  updatedAt: r.updated_at,
});

/** The vault table for the signed-in user (row-level security keeps it private). */
export function supabaseBackend(userId: string): SyncBackend {
  const table = () => supabase().from('vaults');
  return {
    async getVault() {
      const { data, error } = await table().select('*').eq('user_id', userId);
      if (error) throw error;
      const row = (data as VaultDbRow[] | null)?.[0];
      return row ? toRow(row) : null;
    },
    async createVault(row) {
      const { error } = await table().insert({
        user_id: userId,
        ...row,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        if (error.code === '23505') return 'exists';
        throw error;
      }
      return 'ok';
    },
    async updateVault(row, expectedVersion) {
      const { data, error } = await table()
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('version', expectedVersion)
        .select('version');
      if (error) throw error;
      return (data ?? []).length === 1 ? 'ok' : 'conflict';
    },
    async deleteVault() {
      const { error } = await table().delete().eq('user_id', userId);
      if (error) throw error;
    },
  };
}
