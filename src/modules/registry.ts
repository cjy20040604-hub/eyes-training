import type { ModuleId } from '../data/schema';
import { brockModule } from './brock';
import { l1Module } from './l1';
import { l2Module } from './l2';
import { l3Module } from './l3';
import { l4Module } from './l4';
import { l5Module } from './l5';
import { readingModule } from './reading';
import type { ModuleDefinition } from './types';
import { videoModule } from './video';

export const MODULES: ModuleDefinition[] = [
  l1Module,
  l2Module,
  l3Module,
  l4Module,
  l5Module,
  brockModule,
  readingModule,
  videoModule,
];

export const MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

export function getModule(id: ModuleId): ModuleDefinition {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown module ${id}`);
  return m;
}
