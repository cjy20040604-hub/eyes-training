import { DRAFT_SCHEMA, type ModelDraft } from './guardrails';
import { SYSTEM_PROMPT, retryPrompt, userPrompt } from './prompt';
import type { WeeklyFacts } from './facts';

/**
 * Adapters for the browser's built-in, on-device AI (Chrome's Prompt API and Translator API).
 * Nothing is sent over the network: the model runs on this computer. The first use downloads
 * the model once, which the browser only allows after a click (user activation).
 */

export type Availability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Monitor {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void;
}
interface LmSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LmStatic {
  availability(options?: object): Promise<Exclude<Availability, 'unsupported'>>;
  create(options?: object): Promise<LmSession>;
}
interface TrSession {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface TrStatic {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<Exclude<Availability, 'unsupported'>>;
  create(options: object): Promise<TrSession>;
}

const g = globalThis as unknown as { LanguageModel?: LmStatic; Translator?: TrStatic };

const LM_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
const TR_OPTIONS = { sourceLanguage: 'en', targetLanguage: 'zh' };

async function check(
  fn: (() => Promise<Exclude<Availability, 'unsupported'>>) | null,
): Promise<Availability> {
  if (!fn) return 'unsupported';
  try {
    return await fn();
  } catch {
    return 'unavailable';
  }
}

export function modelAvailability(): Promise<Availability> {
  const lm = g.LanguageModel;
  return check(lm ? () => lm.availability(LM_OPTIONS) : null);
}

export function translatorAvailability(): Promise<Availability> {
  const tr = g.Translator;
  return check(tr ? () => tr.availability(TR_OPTIONS) : null);
}

/** Download progress 0..1 while the browser fetches the model the first time. */
type Progress = (fraction: number) => void;

const monitor = (onProgress?: Progress) => (m: Monitor) =>
  m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));

export interface Writer {
  /** Writes a draft; `problems` (from the guardrails) turns it into a corrective retry. */
  write(facts: WeeklyFacts, problems?: string, signal?: AbortSignal): Promise<unknown>;
  destroy(): void;
}

export async function createWriter(onProgress?: Progress): Promise<Writer> {
  const lm = g.LanguageModel;
  if (!lm) throw new Error('No built-in language model in this browser');
  const session = await lm.create({
    ...LM_OPTIONS,
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    monitor: monitor(onProgress),
  });
  return {
    async write(facts, problems, signal) {
      const input = problems ? retryPrompt(problems) : userPrompt(facts);
      const raw = await session.prompt(input, { responseConstraint: DRAFT_SCHEMA, signal });
      return parseDraft(raw);
    },
    destroy: () => session.destroy(),
  };
}

export interface TextTranslator {
  translate(text: string, signal?: AbortSignal): Promise<string>;
  destroy(): void;
}

export async function createTranslator(onProgress?: Progress): Promise<TextTranslator> {
  const tr = g.Translator;
  if (!tr) throw new Error('No built-in translator in this browser');
  const session = await tr.create({ ...TR_OPTIONS, monitor: monitor(onProgress) });
  return {
    translate: (text, signal) => session.translate(text, { signal }),
    destroy: () => session.destroy(),
  };
}

/** Removes Markdown the model sometimes adds (`**3**`), which would show literally. */
export function plainText(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(#+|[-*•])\s+/, '')
    .trim();
}

/** The model is asked for JSON; tolerate a code fence around it, and strip Markdown. */
export function parseDraft(raw: string): unknown {
  const body = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const d = JSON.parse(body) as Partial<ModelDraft> | null;
    if (!d || typeof d !== 'object') return d;
    return {
      ...d,
      headline: typeof d.headline === 'string' ? plainText(d.headline) : d.headline,
      points: Array.isArray(d.points)
        ? d.points.map((p) => (typeof p === 'string' ? plainText(p) : p))
        : d.points,
    };
  } catch {
    return null;
  }
}
