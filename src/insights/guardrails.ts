import { allowedNumbers, type WeeklyFacts } from './facts';

/**
 * Checks every AI draft before it is shown. A draft that fails gets one retry with the
 * problems listed; if it fails again the rule-based recap is shown instead.
 *
 * What is checked:
 *  - shape and length;
 *  - no diagnostic, treatment or outcome language (this is a personal, educational tool);
 *  - nothing that pushes the user to train longer or harder or to ignore discomfort;
 *  - every number in the text appears in the facts (no invented or miscalculated numbers).
 */

export interface Draft {
  headline: string;
  points: string[];
  suggestion: string;
}

export const LIMITS = { headline: 120, point: 240, suggestion: 240, minPoints: 1, maxPoints: 3 } as const;

/** JSON Schema for the model's structured output (Prompt API `responseConstraint`). */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    points: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    suggestion: { type: 'string' },
  },
  required: ['headline', 'points', 'suggestion'],
  additionalProperties: false,
} as const;

interface Rule {
  id: string;
  re: RegExp;
}

/** English: diagnosis, conditions, treatment, outcome promises, unsafe nudges. */
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
  { id: 'overtraining', re: /坚持忍住|忽略(不适|疼痛|头痛|复视)|练更久|更长时间|加练|多练/ },
];

/** Module codes such as "L1" carry digits that are labels, not numbers. */
const LABELS = /\bL[1-5]\b/g;

export function numbersIn(text: string): number[] {
  return (text.replace(LABELS, ' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
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

  const text = [d.headline, ...d.points, d.suggestion].join('\n');
  for (const rule of lang === 'en' ? BANNED_EN : BANNED_ZH) {
    if (rule.re.test(text)) problems.push(`wording:${rule.id}`);
  }
  const allowed = allowedNumbers(facts);
  for (const n of new Set(numbersIn(text))) {
    if (!allowed.has(n)) problems.push(`number:${n}`);
  }
  return problems;
}

/** Plain-English descriptions of problems, used in the retry prompt. */
export function describeProblems(problems: string[]): string {
  return problems
    .map((p) => {
      const [kind, detail] = p.split(':');
      switch (kind) {
        case 'number':
          return `the number ${detail} is not in the facts; use only numbers that appear in the facts`;
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
