/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** package.json version, injected at build time (vite.config.ts `define`). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Cloud sync (optional): Supabase project URL and public anon key. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
