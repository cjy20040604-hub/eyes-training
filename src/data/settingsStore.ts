import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { migrateSettings } from './migrations';
import {
  DISCLAIMER_VERSION,
  SCHEMA_VERSION,
  defaultSettings,
  type Caps,
  type ModuleId,
  type ModuleProgress,
  type Settings,
} from './schema';
import { nowIso } from './util';
import { sanitizeText } from './sanitize';

export const SETTINGS_STORAGE_KEY = 'eyes-training-settings';

export interface SettingsActions {
  acceptDisclaimer: () => void;
  acknowledgeErgonomics: () => void;
  setLocale: (locale: Settings['locale']) => void;
  setRenderer: (rendererId: Settings['rendererId']) => void;
  setActiveCalibration: (id: string | null) => void;
  setClinicianAgreement: (agree: boolean) => void;
  setClinicianNotes: (notes: string) => void;
  setTrainingLock: (locked: boolean, reason?: string) => void;
  setProgressionLock: (locked: boolean, reason?: string) => void;
  updateCaps: (caps: Partial<Caps>) => void;
  setDailyPlanEntry: (moduleId: ModuleId, entry: Partial<Settings['dailyPlan'][ModuleId]>) => void;
  setModuleProgress: (moduleId: ModuleId, progress: ModuleProgress) => void;
  setCyclotorsionEnabled: (enabled: boolean) => void;
  setReducedMotion: (on: boolean) => void;
  replaceAll: (settings: Settings) => void;
  resetAll: () => void;
}

export type SettingsStore = Settings & SettingsActions;

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings(),
      acceptDisclaimer: () =>
        set({ disclaimerAcceptedVersion: DISCLAIMER_VERSION, disclaimerAcceptedAt: nowIso() }),
      acknowledgeErgonomics: () => set({ ergonomicsAcknowledgedAt: nowIso() }),
      setLocale: (locale) => set({ locale }),
      setRenderer: (rendererId) => set({ rendererId }),
      setActiveCalibration: (activeCalibrationId) => set({ activeCalibrationId }),
      setClinicianAgreement: (clinicianAgreement) => set({ clinicianAgreement }),
      setClinicianNotes: (notes) => set({ clinicianNotes: sanitizeText(notes) }),
      setTrainingLock: (locked, reason = '') =>
        set({ trainingLock: { locked, reason: sanitizeText(reason, 500), since: locked ? nowIso() : null } }),
      setProgressionLock: (locked, reason = '') =>
        set({
          progressionLock: { locked, reason: sanitizeText(reason, 500), since: locked ? nowIso() : null },
        }),
      updateCaps: (caps) => set((s) => ({ caps: { ...s.caps, ...caps } })),
      setDailyPlanEntry: (moduleId, entry) =>
        set((s) => ({
          dailyPlan: {
            ...s.dailyPlan,
            [moduleId]: {
              ...(s.dailyPlan[moduleId] ?? { minutes: 0, intensityTier: 'low', enabled: false }),
              ...entry,
            },
          },
        })),
      setModuleProgress: (moduleId, progress) =>
        set((s) => ({ moduleProgress: { ...s.moduleProgress, [moduleId]: progress } })),
      setCyclotorsionEnabled: (cyclotorsionEnabled) => set({ cyclotorsionEnabled }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      replaceAll: (settings) => set({ ...settings }),
      resetAll: () => set({ ...defaultSettings() }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsStore,
      partialize: (state) => {
        // Persist only data fields, never functions.
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(state)) if (typeof v !== 'function') data[k] = v;
        return data as unknown as SettingsStore;
      },
    },
  ),
);

export function disclaimerAccepted(s: Pick<Settings, 'disclaimerAcceptedVersion'>): boolean {
  return s.disclaimerAcceptedVersion === DISCLAIMER_VERSION;
}
