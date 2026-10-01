import type { SymptomCheck } from '../data/schema';

/** Diplopia frequency index at/above which a session counts as "diplopia reported" (sometimes). */
export const DIPLOPIA_REPORTED_AT = 2;
/** Consecutive post-session diplopia reports that lock progression. */
export const DIPLOPIA_LOCK_AFTER = 2;

export interface RedFlagReport {
  suddenDeviationIncrease: boolean;
  newDoubleVision: boolean;
  ptosis: boolean;
  unequalPupils: boolean;
  severeHeadache: boolean;
  otherNeurological: boolean;
}

export const RED_FLAG_KEYS: Array<keyof RedFlagReport> = [
  'suddenDeviationIncrease',
  'newDoubleVision',
  'ptosis',
  'unequalPupils',
  'severeHeadache',
  'otherNeurological',
];

export function emptyRedFlagReport(): RedFlagReport {
  return {
    suddenDeviationIncrease: false,
    newDoubleVision: false,
    ptosis: false,
    unequalPupils: false,
    severeHeadache: false,
    otherNeurological: false,
  };
}

export function hasRedFlag(report: RedFlagReport): boolean {
  return RED_FLAG_KEYS.some((k) => report[k]);
}

export function diplopiaReported(check: Pick<SymptomCheck, 'diplopia'>): boolean {
  return check.diplopia >= DIPLOPIA_REPORTED_AT;
}

/** Any symptom that must trigger an immediate visual-difficulty step back. */
export function discomfortReported(check: SymptomCheck): boolean {
  return (
    check.diplopia >= DIPLOPIA_REPORTED_AT ||
    check.headache >= 2 ||
    check.nausea >= 1 ||
    check.eyestrain >= 2 ||
    check.confusion >= 2
  );
}

/** Session is "clean" for gating purposes: diplopia never/rarely and headache none/mild. */
export function isCleanCheck(check: Pick<SymptomCheck, 'diplopia' | 'headache' | 'nausea'>): boolean {
  return check.diplopia < DIPLOPIA_REPORTED_AT && check.headache <= 1 && check.nausea === 0;
}

/**
 * Number of most-recent consecutive post-session checks reporting diplopia.
 * `postChecks` must be sorted newest first.
 */
export function consecutiveDiplopiaSessions(postChecksNewestFirst: SymptomCheck[]): number {
  let n = 0;
  for (const c of postChecksNewestFirst) {
    if (c.phase !== 'post') continue;
    if (diplopiaReported(c)) n += 1;
    else break;
  }
  return n;
}

export function shouldLockProgression(postChecksNewestFirst: SymptomCheck[]): boolean {
  return consecutiveDiplopiaSessions(postChecksNewestFirst) >= DIPLOPIA_LOCK_AFTER;
}
