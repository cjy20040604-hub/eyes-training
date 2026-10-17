import { checkDraft, describeProblems, type Draft } from './guardrails';
import type { InsightGate, WeeklyFacts } from './facts';
import type { TextTranslator, Writer } from './onDevice';

/**
 * Weekly recap pipeline: gate → model draft → guardrails (one corrective retry) →
 * translation (Chinese) → guardrails again. Any failure falls back to the rule-based recap,
 * so the user always gets a correct summary; the AI only changes how it is phrased.
 */

export type FallbackReason =
  | 'safety'
  | 'too-little'
  | 'no-model'
  | 'checks-failed'
  | 'error'
  | 'timeout'
  | 'no-translator'
  | 'translation-failed';

export interface InsightResult {
  source: 'model' | 'template';
  reason?: FallbackReason;
  draft: Draft;
  /** The model's English draft, when Chinese fell back (shown on request). */
  englishDraft?: Draft;
  /** Model calls made (0, 1 or 2). */
  attempts: number;
  /** Guardrail findings of every rejected draft (or the error of a failed call), in order. */
  problems: string[][];
  /** Messages of failed model calls ("TimeoutError: …"), for diagnosis. */
  errors: string[];
  ms: number;
}

export interface InsightDeps {
  lang: 'en' | 'zh';
  /** Rule-based recap in the output language; its suggestion is also used with AI text. */
  template: (facts: WeeklyFacts) => Draft;
  /** The English rule-based recap (defaults to `template`), for checking English drafts. */
  englishTemplate?: (facts: WeeklyFacts) => Draft;
  /** Sentences added by rules after the model's points (output language). */
  mustSay?: (facts: WeeklyFacts) => string[];
  /** The same in English, for checking the English draft (defaults to `mustSay`). */
  englishMustSay?: (facts: WeeklyFacts) => string[];
  writer: Writer | null;
  translator?: TextTranslator | null;
  signal?: AbortSignal;
  now?: () => number;
  /** Per-call limit; a call that takes longer counts as a failed attempt. */
  timeoutMs?: number;
}

export const MAX_ATTEMPTS = 2;

/**
 * v3: the second real evaluation had model calls that hung for 4 to 6 minutes before
 * failing. Normal calls take 2 to 5 s, so 20 s is a generous limit.
 */
export const ATTEMPT_TIMEOUT_MS = 20_000;

const isTimeout = (e: unknown) => (e as { name?: string } | null)?.name === 'TimeoutError';

/** Runs one model call with a time limit, still honouring the caller's abort signal. */
function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DOMException(`No answer within ${ms / 1000} s`, 'TimeoutError');
      controller.abort(err);
      reject(err);
    }, ms);
  });
  const aborted = new Promise<never>((_, reject) =>
    outer?.addEventListener(
      'abort',
      () => reject(outer.reason ?? new DOMException('Aborted', 'AbortError')),
      {
        once: true,
      },
    ),
  );
  return Promise.race([run(controller.signal), timeout, aborted]).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  });
}

export async function runInsight(
  facts: WeeklyFacts,
  gate: InsightGate,
  deps: InsightDeps,
): Promise<InsightResult> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const problems: string[][] = [];
  let attempts = 0;
  const errors: string[] = [];
  const done = (r: Omit<InsightResult, 'attempts' | 'problems' | 'errors' | 'ms'>): InsightResult => ({
    ...r,
    attempts,
    problems,
    errors,
    ms: Math.round(now() - t0),
  });
  const fallback = (reason: FallbackReason, englishDraft?: Draft) =>
    done({ source: 'template', reason, draft: deps.template(facts), englishDraft });

  if (gate.kind !== 'ok') return fallback(gate.kind);
  if (!deps.writer) return fallback('no-model');

  // The model writes the description; the suggestion comes from the rules.
  const englishSuggestion = (deps.englishTemplate ?? deps.template)(facts).suggestion;
  const englishMustSay = (deps.englishMustSay ?? deps.mustSay)?.(facts) ?? [];
  const withRules = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return raw;
    const d = raw as { points?: unknown };
    const points = Array.isArray(d.points) ? [...(d.points as unknown[]), ...englishMustSay] : d.points;
    return { ...raw, points, suggestion: englishSuggestion };
  };
  let english: Draft | null = null;
  let lastFailure: 'checks' | 'error' | 'timeout' = 'checks';
  let feedback: string | undefined;
  while (attempts < MAX_ATTEMPTS && !english) {
    attempts += 1;
    let raw: unknown;
    try {
      raw = await withTimeout(
        (signal) => deps.writer!.write(facts, feedback, signal),
        deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        deps.signal,
      );
    } catch (e) {
      if (deps.signal?.aborted) throw e;
      // A failed or hung call counts as an attempt; the next one starts again from the facts.
      lastFailure = isTimeout(e) ? 'timeout' : 'error';
      const name = (e as { name?: string } | null)?.name ?? 'Error';
      problems.push([`${lastFailure}:${name}`]);
      errors.push(e instanceof Error || e instanceof DOMException ? `${e.name}: ${e.message}` : String(e));
      feedback = undefined;
      continue;
    }
    const draft = withRules(raw);
    const found = checkDraft(draft, facts, 'en');
    if (found.length === 0) english = draft as Draft;
    else {
      lastFailure = 'checks';
      problems.push(found);
      feedback = describeProblems(found);
    }
  }
  if (!english) return fallback(lastFailure === 'checks' ? 'checks-failed' : lastFailure);
  if (deps.lang === 'en') return done({ source: 'model', draft: english });

  if (!deps.translator) return fallback('no-translator', english);
  try {
    const tr = (s: string) => deps.translator!.translate(s, deps.signal);
    const zh: Draft = {
      headline: await tr(english.headline),
      // The model's points are translated; the rule-added lines come in the output language.
      points: [
        ...(await Promise.all(
          english.points.slice(0, english.points.length - englishMustSay.length).map(tr),
        )),
        ...(deps.mustSay?.(facts) ?? []),
      ],
      suggestion: deps.template(facts).suggestion,
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
