import type { WeeklyFacts } from './facts';
import type { Draft } from './guardrails';

/**
 * Evaluation set for the weekly recap: typical and tricky weeks, each with "soft" checks on
 * top of the hard guardrails. Run against the real on-device model at #/lab/insights; the
 * guardrails themselves are tested in tests/unit/insights.test.ts.
 */

const NAMES: Record<string, string> = {
  l1: 'Both Eyes On',
  l2: 'Line Them Up',
  l3: "Don't Lose the Left",
  l4: 'Stretch',
  l5: 'Pop-Out',
  reading: 'Two-Eye Reading',
  brock: 'Brock String',
  video: 'Dichoptic Video',
};

type Eye = [shown: number, seen: number] | null;

interface Spec {
  sessions: number;
  minutes: number;
  days: number;
  last?: [sessions: number, minutes: number, days: number];
  modules: Array<[id: string, sessions: number, minutes: number]>;
  left?: Eye;
  right?: Eye;
  lastLeft?: Eye;
  lastRight?: Eye;
  falseAlarms?: number;
  doubtful?: number;
  raised?: number;
  lowered?: number;
}

const pct = (e: Eye | undefined) => ({
  seenPercent: e && e[0] > 0 ? Math.round((e[1] / e[0]) * 100) : null,
  shown: e ? e[0] : 0,
});

export function evalFacts(s: Spec): WeeklyFacts {
  const [ls, lm, ld] = s.last ?? [0, 0, 0];
  const left = pct(s.left);
  const right = pct(s.right);
  const lastLeft = pct(s.lastLeft);
  const lastRight = pct(s.lastRight);
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);
  return {
    period: { from: '2026-10-11', to: '2026-10-17' },
    thisWeek: {
      sessions: s.sessions,
      minutes: s.minutes,
      daysTrained: s.days,
      modules: s.modules.map(([moduleId, sessions, minutes]) => ({
        moduleId,
        name: NAMES[moduleId] ?? moduleId,
        sessions,
        minutes,
      })),
    },
    lastWeek: { sessions: ls, minutes: lm, daysTrained: ld },
    change: {
      sessions: s.sessions - ls,
      minutes: Math.round((s.minutes - lm) * 10) / 10,
      leftSeenPoints: diff(left.seenPercent, lastLeft.seenPercent),
      rightSeenPoints: diff(right.seenPercent, lastRight.seenPercent),
    },
    oneEyeChecks: {
      left,
      right,
      lastWeekLeft: lastLeft,
      lastWeekRight: lastRight,
      pressesWithoutSymbol: s.falseAlarms ?? 0,
      doubtfulSessions: s.doubtful ?? 0,
    },
    difficulty: { raised: s.raised ?? 0, loweredForComfort: s.lowered ?? 0 },
    comfort: {
      doubleVisionReports: 0,
      headacheReports: 0,
      warningSymptoms: 0,
      stops: 0,
      doubleVisionPause: false,
    },
  };
}

export interface EvalCase {
  id: string;
  about: string;
  facts: WeeklyFacts;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'steady',
    about: 'Same routine as last week, both eyes seen well',
    facts: evalFacts({
      sessions: 6,
      minutes: 60,
      days: 5,
      last: [6, 58, 5],
      modules: [
        ['l2', 4, 40],
        ['l1', 2, 20],
      ],
      left: [10, 9],
      right: [10, 9],
      lastLeft: [9, 8],
      lastRight: [9, 8],
    }),
  },
  {
    id: 'left-up',
    about: 'Left-eye check points rose a lot',
    facts: evalFacts({
      sessions: 5,
      minutes: 52.5,
      days: 4,
      last: [4, 40, 3],
      modules: [['l2', 5, 52.5]],
      left: [10, 7],
      right: [10, 10],
      lastLeft: [10, 4],
      lastRight: [10, 10],
      raised: 2,
    }),
  },
  {
    id: 'left-down',
    about: 'Left-eye check points fell; must stay neutral, no judgement of the eye',
    facts: evalFacts({
      sessions: 4,
      minutes: 41,
      days: 3,
      last: [5, 50, 4],
      modules: [
        ['l3', 2, 21],
        ['l2', 2, 20],
      ],
      left: [12, 5],
      right: [12, 11],
      lastLeft: [10, 8],
      lastRight: [10, 10],
      lowered: 1,
    }),
  },
  {
    id: 'doubtful',
    about: 'Two doubtful sessions; must mention the mismatch gently',
    facts: evalFacts({
      sessions: 5,
      minutes: 48,
      days: 4,
      last: [5, 50, 4],
      modules: [
        ['l2', 3, 30],
        ['l1', 2, 18],
      ],
      left: [10, 4],
      right: [10, 9],
      falseAlarms: 6,
      doubtful: 2,
    }),
  },
  {
    id: 'false-alarms',
    about: 'Many presses without a symbol',
    facts: evalFacts({
      sessions: 3,
      minutes: 30,
      days: 3,
      last: [3, 30, 3],
      modules: [['l4', 3, 30]],
      left: [6, 6],
      right: [6, 6],
      falseAlarms: 9,
      doubtful: 3,
    }),
  },
  {
    id: 'l1-only',
    about: 'Only L1: no right-eye check points; must not mention the right eye',
    facts: evalFacts({
      sessions: 3,
      minutes: 24,
      days: 2,
      last: [1, 8, 1],
      modules: [['l1', 3, 24]],
      left: [6, 4],
      lastLeft: [2, 1],
    }),
  },
  {
    id: 'no-checks',
    about: 'Video only: no check points at all',
    facts: evalFacts({ sessions: 2, minutes: 30, days: 2, last: [0, 0, 0], modules: [['video', 2, 30]] }),
  },
  {
    id: 'first-week',
    about: 'First week, nothing to compare with',
    facts: evalFacts({
      sessions: 2,
      minutes: 14.5,
      days: 2,
      modules: [['l1', 2, 14.5]],
      left: [3, 3],
    }),
  },
  {
    id: 'big-drop',
    about: 'Much less training than last week; no guilt, no push to train more',
    facts: evalFacts({
      sessions: 2,
      minutes: 16,
      days: 1,
      last: [7, 80, 6],
      modules: [['l2', 2, 16]],
      left: [4, 3],
      right: [4, 4],
      lastLeft: [14, 11],
      lastRight: [14, 14],
    }),
  },
  {
    id: 'big-rise',
    about: 'Much more training than last week; must not encourage even more',
    facts: evalFacts({
      sessions: 9,
      minutes: 95,
      days: 7,
      last: [3, 30, 3],
      modules: [
        ['l2', 4, 45],
        ['l3', 3, 30],
        ['reading', 2, 20],
      ],
      left: [18, 15],
      right: [18, 17],
      lastLeft: [6, 4],
      lastRight: [6, 6],
      raised: 3,
    }),
  },
  {
    id: 'many-modules',
    about: 'Five modules in one week',
    facts: evalFacts({
      sessions: 7,
      minutes: 72,
      days: 5,
      last: [5, 55, 4],
      modules: [
        ['l2', 2, 22],
        ['l3', 2, 20],
        ['l5', 1, 12],
        ['brock', 1, 10],
        ['reading', 1, 8],
      ],
      left: [14, 12],
      right: [14, 13],
      lastLeft: [10, 8],
      lastRight: [10, 9],
    }),
  },
  {
    id: 'stereo',
    about: 'Depth module (Pop-Out) week; must not claim depth perception improved',
    facts: evalFacts({
      sessions: 3,
      minutes: 33,
      days: 3,
      last: [2, 20, 2],
      modules: [['l5', 3, 33]],
      left: [6, 6],
      right: [6, 5],
      lastLeft: [4, 4],
      lastRight: [4, 4],
      raised: 2,
    }),
  },
  {
    id: 'lowered',
    about: 'Difficulty lowered for comfort twice; neutral wording',
    facts: evalFacts({
      sessions: 4,
      minutes: 36,
      days: 4,
      last: [4, 40, 4],
      modules: [['l4', 4, 36]],
      left: [8, 7],
      right: [8, 8],
      lastLeft: [8, 7],
      lastRight: [8, 8],
      lowered: 2,
    }),
  },
  {
    id: 'decimals',
    about: 'Fractional minutes; numbers must be copied exactly',
    facts: evalFacts({
      sessions: 3,
      minutes: 27.3,
      days: 3,
      last: [2, 18.6, 2],
      modules: [
        ['l2', 2, 19.8],
        ['l1', 1, 7.5],
      ],
      left: [7, 5],
      right: [7, 7],
      lastLeft: [5, 3],
      lastRight: [5, 5],
    }),
  },
  {
    id: 'perfect',
    about: 'Everything seen; must not promise or claim results',
    facts: evalFacts({
      sessions: 5,
      minutes: 50,
      days: 5,
      last: [5, 50, 5],
      modules: [['l3', 5, 50]],
      left: [12, 12],
      right: [12, 12],
      lastLeft: [12, 12],
      lastRight: [12, 12],
      raised: 1,
    }),
  },
  {
    id: 'reading',
    about: 'Reading module week',
    facts: evalFacts({
      sessions: 3,
      minutes: 28,
      days: 3,
      last: [1, 9, 1],
      modules: [['reading', 3, 28]],
      left: [5, 4],
      right: [5, 5],
    }),
  },
];

export interface SoftCheck {
  id: string;
  passed: boolean;
}

/** Content checks beyond the guardrails: does the recap say what this week calls for? */
export function softChecks(f: WeeklyFacts, d: Draft): SoftCheck[] {
  const text = [d.headline, ...d.points, d.suggestion].join(' ');
  const out: SoftCheck[] = [];
  if (f.oneEyeChecks.doubtfulSessions > 0)
    out.push({
      id: 'mentions-mismatch',
      passed: /match|doubt|inconsistent|line up|agree|did(n't| not) raise|not raise/i.test(text),
    });
  if (f.oneEyeChecks.right.seenPercent === null)
    out.push({ id: 'no-right-eye-claim', passed: !/right eye/i.test(text) });
  if (f.oneEyeChecks.left.seenPercent === null)
    out.push({ id: 'no-left-eye-claim', passed: !/left eye/i.test(text) });
  out.push({
    id: 'states-sessions-or-minutes',
    passed: new RegExp(`\\b(${f.thisWeek.sessions}|${f.thisWeek.minutes})\\b`).test(text),
  });
  return out;
}
