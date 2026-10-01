import type { ModuleId } from '../data/schema';
import { l1Module } from './l1';
import { l2Module } from './l2';
import type { IntensityMap, ModuleDefinition } from './types';

/** Placeholder definitions for Phase 2 modules: listed, gated, not runnable yet. */
function placeholder(
  id: ModuleId,
  code: string,
  intensity: IntensityMap,
  minutes: [number, number, number],
): ModuleDefinition {
  return {
    id,
    code,
    minMinutes: minutes[0],
    defaultMinutes: minutes[1],
    maxMinutes: minutes[2],
    intensity,
    implemented: false,
    create: () => {
      throw new Error(`Module ${id} is not implemented yet`);
    },
  };
}

const contrastIntensity: IntensityMap = {
  metric: 'dominantContrastRatio',
  unit: '',
  valueForTier: (tier, c) => {
    const b = c.contrastBalance.balanceRatio;
    return tier === 'low' ? b : tier === 'medium' ? b + (1 - b) * 0.25 : b + (1 - b) * 0.5;
  },
  bounds: () => ({ min: 0.05, max: 1 }),
  maxStepPerSession: 0.05,
  stepBack: 0.1,
  harderDirection: 1,
  requiresClinician: false,
  format: (v) => `${Math.round(v * 100)}%`,
};

const vergenceIntensity: IntensityMap = {
  metric: 'vergenceDemandDelta',
  unit: 'Δ',
  valueForTier: (tier) => (tier === 'low' ? 2 : tier === 'medium' ? 4 : 6),
  // Ceilings well below normal adult amplitudes (near convergence ~20-25Δ break).
  bounds: () => ({ min: 0, max: 12 }),
  maxStepPerSession: 1,
  stepBack: 2,
  harderDirection: 1,
  requiresClinician: true,
  format: (v) => `${v.toFixed(1)}Δ`,
};

const stereoIntensity: IntensityMap = {
  metric: 'stereoDisparityArcsec',
  unit: '″',
  valueForTier: (tier) => (tier === 'low' ? 800 : tier === 'medium' ? 400 : 200),
  bounds: () => ({ min: 40, max: 1600 }),
  maxStepPerSession: 100,
  stepBack: 200,
  harderDirection: -1,
  requiresClinician: false,
  format: (v) => `${Math.round(v)}″`,
};

const videoIntensity: IntensityMap = {
  metric: 'dichopticStrength',
  unit: '',
  valueForTier: (tier) => (tier === 'low' ? 0.3 : tier === 'medium' ? 0.5 : 0.7),
  bounds: () => ({ min: 0, max: 0.9 }),
  maxStepPerSession: 0.05,
  stepBack: 0.1,
  harderDirection: 1,
  requiresClinician: false,
  format: (v) => `${Math.round(v * 100)}%`,
};

export const MODULES: ModuleDefinition[] = [
  l1Module,
  l2Module,
  placeholder('l3', 'L3', contrastIntensity, [3, 4, 5]),
  placeholder('l4', 'L4', vergenceIntensity, [3, 3, 5]),
  placeholder('l5', 'L5', stereoIntensity, [3, 3, 5]),
  placeholder('video', 'V', videoIntensity, [5, 10, 15]),
];

export const MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

export function getModule(id: ModuleId): ModuleDefinition {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown module ${id}`);
  return m;
}
