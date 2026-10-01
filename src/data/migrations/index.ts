import { SCHEMA_VERSION, defaultSettings, settingsSchema, type Settings } from '../schema';

/**
 * Settings migrations (localStorage). Each step upgrades from version N to N+1.
 * IndexedDB tables migrate via Dexie version() upgrades in db.ts.
 */
type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

export const settingsMigrations: Record<number, Migration> = {
  // 0 -> 1: initial. Nothing stored before v1; merge onto defaults.
  0: (input) => ({ ...defaultSettings(), ...input, schemaVersion: 1 }),
};

export function migrateSettings(raw: unknown, fromVersion: number): Settings {
  let data: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let v = Number.isFinite(fromVersion) ? fromVersion : 0;
  while (v < SCHEMA_VERSION) {
    const step = settingsMigrations[v];
    if (!step) break;
    data = step(data);
    v += 1;
  }
  const merged = deepMergeDefaults(defaultSettings() as unknown as Record<string, unknown>, data);
  merged['schemaVersion'] = SCHEMA_VERSION;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings();
}

function deepMergeDefaults(
  defaults: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(data)) {
    const d = defaults[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) {
      out[k] = deepMergeDefaults(d as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}
