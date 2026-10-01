import { useCallback, useEffect, useState } from 'react';
import { getDb } from './db';
import type { CalibrationProfile, SafetyEvent, SessionRecord, SymptomCheck } from './schema';
import { useSettings } from './settingsStore';

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: Error | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export interface AllData {
  calibrations: CalibrationProfile[];
  sessions: SessionRecord[];
  checks: SymptomCheck[];
  safetyEvents: SafetyEvent[];
}

export async function loadAllData(): Promise<AllData> {
  const db = getDb();
  const [calibrations, sessions, checks, safetyEvents] = await Promise.all([
    db.calibrations.toArray(),
    db.sessions.toArray(),
    db.symptomChecks.toArray(),
    db.safetyEvents.toArray(),
  ]);
  return { calibrations, sessions, checks, safetyEvents };
}

export function useAllData(): ReturnType<typeof useAsync<AllData>> {
  return useAsync(loadAllData, []);
}

export function useActiveCalibration(): {
  calibration: CalibrationProfile | null;
  loading: boolean;
  reload: () => void;
} {
  const id = useSettings((s) => s.activeCalibrationId);
  const { data, loading, reload } = useAsync(
    async () => (id ? ((await getDb().calibrations.get(id)) ?? null) : null),
    [id],
  );
  return { calibration: data, loading, reload };
}
