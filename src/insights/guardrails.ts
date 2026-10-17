import { allowedNumbers, type WeeklyFacts } from './facts';

/**
 * Checks every AI draft before it is shown. A draft that fails gets one retry with the
 * problems listed; if it fails again the rule-based recap is shown instead.
 *
 * What is checked:
 *  - shape and length;
 *  - no diagnostic, treatment, outcome or over-training wording (personal, educational tool);
 *  - every number appears in the facts, and is used for what it measures: a percentage must
 *    be a percentage in the facts, minutes must be minutes, and so on (v2: the first real
 *    evaluation showed grounded numbers used for the wrong thing, e.g. a change of 6
 *    percentage points reported as "6 points seen");
 *  - claims the facts cannot support: per-day figures, an eye that had no check points,
 *    praise such as "consistent" in a light week;
 *  - required content: mismatched reports must be mentioned.
 */

export interface Draft {
  headline: string;
  points: string[];
  suggestion: string;
}

/** What the model writes. The suggestion is chosen by rules (safety-relevant advice). */
export type ModelDraft = Omit<Draft, 'suggestion'>;

/** Up to 3 points from the model, plus a must-say line added by rules. */
export const LIMITS = { headline: 120, point: 240, suggestion: 240, minPoints: 1, maxPoints: 4 } as const;

/** JSON Schema for the model's structured output (Prompt API `responseConstraint`). */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    // Length limits also bound generation (v3: two calls ran for minutes before failing).
    headline: { type: 'string', maxLength: 120 },
    points: { type: 'array', items: { type: 'string', maxLength: 240 }, minItems: 1, maxItems: 3 },
  },
  required: ['headline', 'points'],
  additionalProperties: false,
} as const;

interface Rule {
  id: string;
  re: RegExp;
}

/** English: diagnosis, conditions, treatment, outcome claims, unsafe nudges. */
export const BANNED_EN: Rule[] = [
  { id: 'diagnosis', re: /diagnos/i },
  { id: 'cure', re: /\bcur(e|es|ed|ing)\b/i },
  { id: 'heal', re: /\bheal/i },
  { id: 'treatment', re: /\btreat|therap/i },
  { id: 'condition-name', re: /amblyop|strabism|lazy eye|\bsquint|esotrop|exotrop|binocular dysfunction/i },
  { id: 'disease', re: /disorder|disease|deficien|impair/i },
  { id: 'suppression-claim', re: /suppress/i },
  { id: 'eye-judgement', re: /\b(weak|weaker|bad|lazy|good|better|dominant|strong|stronger) eye\b/i },
  {
    id: 'vision-claim',
    re: /eyesight|\bvision (is|has|got|will|improv)|normal vision|depth perception (is|has|improv)/i,
  },
  { id: 'medical', re: /\bmedic|prescri|\bclinical/i },
  { id: 'promise', re: /guarantee|permanent|will (improve|fix|restore|get better)|fixed for good/i },
  { id: 'outcome', re: /\bprogress|\bskills?\b|improv/i },
  { id: 'measurement', re: /accura|recogni/i },
  { id: 'third-person', re: /\bthe user\b/i },
  {
    id: 'overtraining',
    re: /push through|ignore (the |any |your )?(pain|discomfort|symptom|headache|double)|(train|practi[cs]e|play) (longer|harder|more)|longer sessions|extra sessions?/i,
  },
];

/** Chinese counterparts, for the translated recap. */
export const BANNED_ZH: Rule[] = [
  { id: 'diagnosis', re: /诊断/ },
  { id: 'cure', re: /治愈|痊愈|根治|康复/ },
  { id: 'treatment', re: /治疗|疗效|疗法/ },
  { id: 'condition-name', re: /弱视|斜视|懒惰眼|内斜|外斜/ },
  { id: 'disease', re: /疾病|病症|障碍|缺陷/ },
  { id: 'suppression-claim', re: /抑制/ },
  { id: 'eye-judgement', re: /(弱|差|坏|好|强|主导)的?眼/ },
  { id: 'vision-claim', re: /视力|立体视觉?(已|有所)?(改善|提高|恢复)/ },
  { id: 'medical', re: /医学|医疗|处方|临床/ },
  { id: 'promise', re: /保证|永久|一定会|肯定会/ },
  { id: 'outcome', re: /进步|进展|技能/ },
  { id: 'measurement', re: /准确率|识别率|正确率/ },
  { id: 'overtraining', re: /坚持忍住|忽略(不适|疼痛|头痛|复视)|练更久|更长时间|加练|多练/ },
];

/** Module codes such as "L1" carry digits that are labels, not numbers. */
const LABELS = /\bL[1-5]\b/g;

export function numbersIn(text: string): number[] {
  return (text.replace(LABELS, ' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** A light week: few training days, or far fewer sessions than the week before. */
export function isLightWeek(f: WeeklyFacts): boolean {
  return (
    f.thisWeek.daysTrained <= 2 ||
    (f.lastWeek.sessions > 0 && f.thisWeek.sessions <= 0.6 * f.lastWeek.sessions)
  );
}

const MISMATCH_MENTION = /match|doubt|inconsistent|line up|agree|did(n't| not) raise|not raise/i;
/** Stricter: an actual claim that reports did not match ("matching last week" is not one). */
const MISMATCH_CLAIM = /did(n't| not)( quite)? match|mismatch|doubt|inconsisten|did(n't| not) agree/i;
/** A headline that stops mid-phrase ("Week of"). */
const INCOMPLETE = /\b(of|the|a|an|and|or|to|with|for|in|on|at|by|from)\s*[.:!-]?$/i;

/** Which values each unit may take, from the facts. */
function unitValues(f: WeeklyFacts) {
  const abs = (xs: Array<number | null>) => new Set(xs.filter((x): x is number => x !== null).map(Math.abs));
  const c = f.oneEyeChecks;
  return {
    percent: abs([
      c.left.seenPercent,
      c.right.seenPercent,
      c.lastWeekLeft.seenPercent,
      c.lastWeekRight.seenPercent,
      100,
    ]),
    percentagePoints: abs([f.change.leftSeenPoints, f.change.rightSeenPoints]),
    minutes: abs([
      f.thisWeek.minutes,
      f.lastWeek.minutes,
      f.change.minutes,
      ...f.thisWeek.modules.map((m) => m.minutes),
    ]),
    sessions: abs([
      f.thisWeek.sessions,
      f.lastWeek.sessions,
      f.change.sessions,
      c.doubtfulSessions,
      f.difficulty.raised,
      f.difficulty.loweredForComfort,
      ...f.thisWeek.modules.map((m) => m.sessions),
    ]),
    days: abs([f.thisWeek.daysTrained, f.lastWeek.daysTrained, 7]),
  };
}

const UNITS_EN: Array<[keyof ReturnType<typeof unitValues>, RegExp]> = [
  ['percentagePoints', /(\d+(?:\.\d+)?)\s+percentage[\s-]+points?\b/gi],
  ['percent', /(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi],
  ['minutes', /(\d+(?:\.\d+)?)\s*(?:more\s+|fewer\s+|less\s+)?(?:minutes?|mins?)\b/gi],
  ['sessions', /(\d+)\s*(?:more\s+|fewer\s+)?sessions?\b/gi],
  ['days', /(\d+)\s*(?:more\s+|fewer\s+)?days?\b/gi],
];

const UNITS_ZH: Array<[keyof ReturnType<typeof unitValues>, RegExp]> = [
  ['percentagePoints', /(\d+(?:\.\d+)?)\s*个?百分点/g],
  ['percent', /(\d+(?:\.\d+)?)\s*%/g],
  ['minutes', /(\d+(?:\.\d+)?)\s*分钟/g],
  ['days', /(\d+)\s*天/g],
];

function unitProblems(text: string, f: WeeklyFacts, lang: 'en' | 'zh'): string[] {
  const values = unitValues(f);
  const out: string[] = [];
  for (const [unit, re] of lang === 'en' ? UNITS_EN : UNITS_ZH) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (!values[unit].has(n)) out.push(`unit:${unit}:${n}`);
    }
  }
  // "6 points" / "6 check points" without "percentage": a change read as a count.
  if (lang === 'en') {
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s+((?:[a-z-]+\s+){0,2})points?\b/gi)) {
      if (!/percentage/i.test(m[2] ?? '')) out.push(`unit:points:${m[1]}`);
    }
  }
  return out;
}

export function checkDraft(draft: unknown, facts: WeeklyFacts, lang: 'en' | 'zh' = 'en'): string[] {
  const problems: string[] = [];
  const d = draft as Partial<Draft> | null;
  if (
    !d ||
    typeof d.headline !== 'string' ||
    typeof d.suggestion !== 'string' ||
    !Array.isArray(d.points) ||
    d.points.some((p) => typeof p !== 'string')
  ) {
    return ['shape'];
  }
  if (!d.headline.trim()) problems.push('empty:headline');
  if (!d.suggestion.trim()) problems.push('empty:suggestion');
  if (d.points.length < LIMITS.minPoints || d.points.length > LIMITS.maxPoints) problems.push('count:points');
  if (d.headline.length > LIMITS.headline) problems.push('length:headline');
  if (d.suggestion.length > LIMITS.suggestion) problems.push('length:suggestion');
  if (d.points.some((p) => p.length > LIMITS.point)) problems.push('length:point');

  // Module names ("Both Eyes On", "Don't Lose the Left") are not claims.
  const unname = (s: string) =>
    facts.thisWeek.modules.reduce((acc, m) => acc.split(m.name).join('(module)'), s);
  const text = unname([d.headline, ...d.points, d.suggestion].join('\n'));
  const description = unname([d.headline, ...d.points].join('\n'));
  if (
    lang === 'en' &&
    d.headline.trim() &&
    (d.headline.trim().split(/\s+/).length < 3 || INCOMPLETE.test(unname(d.headline).trim()))
  )
    problems.push('incomplete:headline');
  // v4: a headline must carry this week's specifics, a number or an exact module name.
  const headline = d.headline.trim();
  if (
    lang === 'en' &&
    headline &&
    !/\d/.test(headline) &&
    !facts.thisWeek.modules.some((m) => headline.toLowerCase().includes(m.name.toLowerCase()))
  )
    problems.push('vague:headline');

  for (const rule of lang === 'en' ? BANNED_EN : BANNED_ZH) {
    if (rule.re.test(text)) problems.push(`wording:${rule.id}`);
  }
  const allowed = allowedNumbers(facts);
  for (const n of new Set(numbersIn(text))) {
    if (!allowed.has(n)) problems.push(`number:${n}`);
  }
  problems.push(...new Set(unitProblems(text, facts, lang)));

  if (lang === 'en') {
    if (/\b(each|per|every) day\b|\bdaily\b|\ba day\b/i.test(description)) problems.push('claim:per-day');
    const c = facts.oneEyeChecks;
    const anyEye = /\b(both|each) eyes?\b/i;
    if (
      (c.left.seenPercent === null && (/left eye/i.test(text) || anyEye.test(text))) ||
      (c.right.seenPercent === null && (/right eye/i.test(text) || anyEye.test(text)))
    )
      problems.push('claim:absent-eye');
    if (
      isLightWeek(facts) &&
      /consisten|steady|keep up the good work|great week|well done/i.test(description)
    )
      problems.push('framing:praise-light-week');
    if (c.doubtfulSessions > 0 && !MISMATCH_MENTION.test(description)) problems.push('missing:mismatch');
    if (c.doubtfulSessions === 0 && MISMATCH_CLAIM.test(description)) problems.push('claim:mismatch');
  }
  return problems;
}

/** Plain-English descriptions of problems, used in the retry prompt. */
export function describeProblems(problems: string[]): string {
  return problems
    .map((p) => {
      const [kind, detail, value] = p.split(':');
      switch (kind) {
        case 'number':
          return `the number ${detail} is not in the facts; use only numbers that appear in the facts`;
        case 'unit':
          return detail === 'points'
            ? `"${value} points" is unclear: changes are "percentage points", and there is no count of symbols seen`
            : `${value} is not a ${detail === 'percentagePoints' ? 'percentage-point change' : detail} value in the facts; keep each number with what it measures`;
        case 'claim':
          return detail === 'per-day'
            ? 'there are no per-day figures; do not say "each day", "per day" or "daily"'
            : detail === 'mismatch'
              ? 'all reports matched this week; do not mention mismatches'
              : 'do not mention an eye that had no check points';
        case 'vague':
          return 'the headline must contain a number from the facts or the exact name of a module';
        case 'incomplete':
          return 'the headline is incomplete; write a complete phrase of 4 to 12 words';
        case 'framing':
          return 'training was lighter than the week before: describe it plainly, without calling it consistent or praising it';
        case 'missing':
          return 'mention gently that some reports did not match, so those sessions did not raise the difficulty';
        case 'wording':
          return `avoid ${detail?.replace(/-/g, ' ')} wording`;
        case 'length':
          return `the ${detail} is too long`;
        case 'count':
          return 'give 1 to 3 points';
        case 'empty':
          return `the ${detail} is empty`;
        default:
          return 'answer with the JSON object only';
      }
    })
    .join('; ');
}
