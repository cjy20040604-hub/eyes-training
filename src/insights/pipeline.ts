import { checkDraft, describeProblems, type Draft } from './guardrails';
import type { InsightGate, WeeklyFacts } from './facts';
import type { TextTranslator, Writer } from './onDevice';

/**
 * Weekly recap pipeline: gate → model draft → guardrails (one corrective retry) →
 * translation (Chinese) → guardrails again. Any failure falls back to the rule-based recap,
 * so the user always gets a correct summary; the AI only changes how it is phrased.
 */

export type FallbackReason =
  'safety' | 'too-little' | 'no-model' | 'checks-failed' | 'error' | 'no-translator' | 'translation-failed';

export interface InsightResult {
  source: 'model' | 'template';
  reason?: FallbackReason;
  draft: Draft;
  /** The model's English draft, when Chinese fell back (shown on request). */
  englishDraft?: Draft;
  /** Model calls made (0, 1 or 2). */
  attempts: number;
  /** Guardrail findings of every rejected draft, in order. */
  problems: string[][];
  ms: number;
}

export interface InsightDeps {
  lang: 'en' | 'zh';
  template: (facts: WeeklyFacts) => Draft;
  writer: Writer | null;
  translator?: TextTranslator | null;
  signal?: AbortSignal;
  now?: () => number;
}

export const MAX_ATTEMPTS = 2;

export async function runInsight(
  facts: WeeklyFacts,
  gate: InsightGate,
  deps: InsightDeps,
): Promise<InsightResult> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const problems: string[][] = [];
  let attempts = 0;
  const done = (r: Omit<InsightResult, 'attempts' | 'problems' | 'ms'>): InsightResult => ({
    ...r,
    attempts,
    problems,
    ms: Math.round(now() - t0),
  });
  const fallback = (reason: FallbackReason, englishDraft?: Draft) =>
    done({ source: 'template', reason, draft: deps.template(facts), englishDraft });

  if (gate.kind !== 'ok') return fallback(gate.kind);
  if (!deps.writer) return fallback('no-model');

  let english: Draft | null = null;
  try {
    let feedback: string | undefined;
    while (attempts < MAX_ATTEMPTS && !english) {
      attempts += 1;
      const draft = await deps.writer.write(facts, feedback, deps.signal);
      const found = checkDraft(draft, facts, 'en');
      if (found.length === 0) english = draft as Draft;
      else {
        problems.push(found);
        feedback = describeProblems(found);
      }
    }
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    return fallback('error');
  }
  if (!english) return fallback('checks-failed');
  if (deps.lang === 'en') return done({ source: 'model', draft: english });

  if (!deps.translator) return fallback('no-translator', english);
  try {
    const tr = (s: string) => deps.translator!.translate(s, deps.signal);
    const zh: Draft = {
      headline: await tr(english.headline),
      points: await Promise.all(english.points.map(tr)),
      suggestion: await tr(english.suggestion),
    };
    const found = checkDraft(zh, facts, 'zh');
    if (found.length) {
      problems.push(found);
      return fallback('translation-failed', english);
    }
    return done({ source: 'model', draft: zh, englishDraft: english });
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    return fallback('translation-failed', english);
  }
}
