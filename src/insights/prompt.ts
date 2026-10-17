import type { WeeklyFacts } from './facts';
import { isLightWeek } from './guardrails';

/**
 * Prompt for the weekly recap. The model writes English (the on-device model's output
 * languages do not include Chinese yet); Chinese users get an on-device translation.
 *
 * v2, after the first evaluation on the real model: facts are given as short labelled
 * sentences instead of nested JSON (the model had read a week-over-week change as a count),
 * each number travels with its unit, and the suggestion is no longer written by the model
 * (it copied the prompt's example in 15 of 16 cases; safety-relevant advice is now chosen by
 * rules).
 *
 * v4, after the third: content that must be said (mismatched reports) is added by rules
 * instead of requested from the model, which had learned to satisfy the check with the right
 * keywords but the wrong meaning; headlines must name a number or an exact module.
 */
export const PROMPT_VERSION = 'v4';

export const SYSTEM_PROMPT = `You write a short, friendly weekly recap for one adult who uses a personal, educational app with red/cyan-glasses games that train the two eyes to work together.

Rules:
1. Use only the facts you are given. Copy every number together with what it measures (sessions, minutes, days, percent, percentage points). Do not calculate, and do not mention dates.
2. There are no per-day figures: never write "each day", "per day" or "daily".
3. Describe what happened in terms of what the user reported (say "reported seeing", not accuracy, recognition or scores). Never diagnose, never name eye conditions, never talk about eyesight, treatment, progress, skills or improvement, never judge an eye as weak, strong, good or bad, and never promise results.
4. Only mention an eye when the facts give a percentage for it.
5. Never write about whether reports matched: the app adds that sentence itself when needed.
6. When the facts say the week was lighter, describe it plainly: no praise such as "consistent" or "keep up the good work", and no push to train more.
7. Plain text only (no Markdown). Write to the reader as "you", never "the user". Headline: a complete phrase of 4 to 12 words that contains a number from the facts or the exact name of a module, not a generic title. Points: 2 or 3, each at most 30 words, each saying something different.

Answer with a JSON object: {"headline": string, "points": string[]}.`;

const signed = (n: number) => (n > 0 ? `up ${n}` : n < 0 ? `down ${-n}` : 'no change');

/** The facts as short sentences, each number next to its unit. */
export function factSentences(f: WeeklyFacts): string[] {
  const c = f.oneEyeChecks;
  const out = [
    `Sessions this week: ${f.thisWeek.sessions} (last week: ${f.lastWeek.sessions}; ${signed(f.change.sessions)}).`,
    `Training time this week: ${f.thisWeek.minutes} minutes in total (last week: ${f.lastWeek.minutes} minutes).`,
    `Days with training: ${f.thisWeek.daysTrained} of the last 7 days (last week: ${f.lastWeek.daysTrained} days).`,
  ];
  for (const m of f.thisWeek.modules)
    out.push(`Module "${m.name}": ${m.sessions} sessions, ${m.minutes} minutes.`);
  for (const [eye, now, before, change] of [
    ['left', c.left, c.lastWeekLeft, f.change.leftSeenPoints],
    ['right', c.right, c.lastWeekRight, f.change.rightSeenPoints],
  ] as const) {
    if (now.seenPercent === null) {
      out.push(
        `${eye === 'left' ? 'Left' : 'Right'} eye: no check symbols were shown this week. Do not mention the ${eye} eye.`,
      );
      continue;
    }
    const last =
      before.seenPercent === null
        ? 'no figure from last week'
        : `last week ${before.seenPercent}%; ${change === null || change === 0 ? 'no change' : `${signed(change)} percentage points`}`;
    out.push(
      `${eye === 'left' ? 'Left' : 'Right'} eye: the user reported seeing ${now.seenPercent}% of the check symbols shown only to the ${eye} eye (${last}).`,
    );
  }
  // v4: whether reports matched is not given to the model; the app adds a fixed sentence.
  if (f.difficulty.raised > 0)
    out.push(`The app raised the difficulty automatically ${f.difficulty.raised} times.`);
  if (f.difficulty.loweredForComfort > 0)
    out.push(
      `The app lowered the difficulty automatically for comfort ${f.difficulty.loweredForComfort} times.`,
    );
  if (isLightWeek(f))
    out.push(
      f.lastWeek.sessions > 0 && f.thisWeek.sessions <= 0.6 * f.lastWeek.sessions
        ? 'This week had far fewer sessions than last week: describe it plainly, without praise such as "consistent".'
        : `Training happened on only ${f.thisWeek.daysTrained} days this week: describe it plainly, without praise such as "consistent".`,
    );
  return out;
}

export function userPrompt(f: WeeklyFacts): string {
  return `Facts:\n${factSentences(f)
    .map((s) => `- ${s}`)
    .join('\n')}\n\nWrite this week's recap.`;
}

export function retryPrompt(problems: string): string {
  return `A previous draft of this recap broke these rules: ${problems}. Write the recap, following every rule.`;
}
