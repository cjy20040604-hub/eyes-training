import type { SessionRecord } from './schema';

/**
 * Report consistency, from the monocular catch trials ("only one eye can see this").
 *
 * Every module shows small symbols to one eye at a time (L1 uses its chick, left eye only).
 * Two things make a session's self-reports doubtful:
 *  - presses without any symbol on screen (more often than real sightings);
 *  - the session's own results say both eyes took part (e.g. the ball was confirmed inside
 *    the ring, or the Brock strings were seen crossing), yet one eye's symbols were mostly
 *    missed.
 * This is information for the user and their records, not a verdict: attention, glasses
 * slipping or suppression switching on and off all produce it. A doubtful session does not
 * raise the difficulty.
 */

export interface EyeCatch {
  shown: number;
  seen: number;
}

export interface SessionCatch {
  left: EyeCatch;
  right: EyeCatch;
  falseAlarms: number;
}

export type InconsistencyReason = 'presses-without-symbol' | 'left-missed' | 'right-missed';

const n = (m: Record<string, number>, k: string) => (Number.isFinite(m[k]) ? (m[k] as number) : 0);

export function sessionCatch(s: SessionRecord): SessionCatch {
  const m = s.metrics;
  if (s.moduleId === 'l1') {
    return {
      left: { shown: n(m, 'probesShown'), seen: n(m, 'probesHit') },
      right: { shown: 0, seen: 0 },
      falseAlarms: n(m, 'probeFalseAlarms'),
    };
  }
  return {
    left: { shown: n(m, 'catchShownLeft'), seen: n(m, 'catchHitLeft') },
    right: { shown: n(m, 'catchShownRight'), seen: n(m, 'catchHitRight') },
    falseAlarms: n(m, 'catchFalseAlarms'),
  };
}

/** Whether the session's own results say both eyes were taking part. */
export function bothEyesReported(s: SessionRecord): boolean {
  const m = s.metrics;
  switch (s.moduleId) {
    case 'l1':
      return n(m, 'timeInCageFraction') >= 0.4;
    case 'l2':
      return n(m, 'confirmedAlignments') >= 1 || n(m, 'autoAlignments') >= 2;
    case 'l3':
      return n(m, 'catchRate') >= 0.6;
    case 'l4':
      return n(m, 'rounds') >= 1;
    case 'l5':
      return n(m, 'trials') >= 4 && n(m, 'percentCorrect') >= 0.5;
    case 'brock':
      return n(m, 'beadsConfirmed') >= 1;
    case 'reading':
      return n(m, 'pagesRead') >= 1 && n(m, 'missingReports') === 0;
    default:
      return false;
  }
}

export function sessionInconsistencies(s: SessionRecord): InconsistencyReason[] {
  const c = sessionCatch(s);
  const reasons: InconsistencyReason[] = [];
  const seen = c.left.seen + c.right.seen;
  if (c.falseAlarms >= 2 && c.falseAlarms >= seen) reasons.push('presses-without-symbol');
  if (bothEyesReported(s)) {
    for (const eye of ['left', 'right'] as const) {
      const e = c[eye];
      if (e.shown >= 2 && e.seen / e.shown < 0.5) reasons.push(`${eye}-missed`);
    }
  }
  return reasons;
}

export interface ConsistencySummary {
  sessions: number;
  left: EyeCatch;
  right: EyeCatch;
  falseAlarms: number;
  flagged: Array<{ session: SessionRecord; reasons: InconsistencyReason[] }>;
}

export function summarizeConsistency(sessions: SessionRecord[]): ConsistencySummary {
  const done = sessions.filter((s) => s.status === 'completed' || s.status === 'stopped');
  const out: ConsistencySummary = {
    sessions: done.length,
    left: { shown: 0, seen: 0 },
    right: { shown: 0, seen: 0 },
    falseAlarms: 0,
    flagged: [],
  };
  for (const s of done) {
    const c = sessionCatch(s);
    out.left.shown += c.left.shown;
    out.left.seen += c.left.seen;
    out.right.shown += c.right.shown;
    out.right.seen += c.right.seen;
    out.falseAlarms += c.falseAlarms;
    const reasons = sessionInconsistencies(s);
    if (reasons.length) out.flagged.push({ session: s, reasons });
  }
  out.flagged.sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt));
  return out;
}

export const seenRate = (e: EyeCatch): number | null => (e.shown > 0 ? e.seen / e.shown : null);
