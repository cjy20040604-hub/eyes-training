import { beforeAll, describe, expect, it } from 'vitest';
import i18n, { initI18n, loadLocale } from '../../src/i18n';
import { EVAL_CASES, evalFacts, softChecks } from '../../src/insights/evalCases';
import {
  allowedNumbers,
  factsForModel,
  insightGate,
  weeklyFacts,
  type InsightData,
} from '../../src/insights/facts';
import { checkDraft, describeProblems, numbersIn, type Draft } from '../../src/insights/guardrails';
import { parseDraft, type TextTranslator, type Writer } from '../../src/insights/onDevice';
import { factSentences } from '../../src/insights/prompt';
import { runInsight } from '../../src/insights/pipeline';
import { templateDraft } from '../../src/insights/template';
import { makeCheck, makeSession } from '../fixtures/factories';

beforeAll(async () => {
  await initI18n('en');
  await loadLocale('zh-Hans');
});

const TODAY = new Date(2026, 9, 17, 12); // 17 Oct 2026, local time
const name = (id: string) => `Module ${id}`;

function session(day: string, over: Parameters<typeof makeSession>[0] = {}) {
  return makeSession({ day, startedAt: `${day}T10:00:00.000Z`, actualMinutes: 10, ...over });
}

const empty: InsightData = { sessions: [], checks: [], safetyEvents: [] };

describe('weekly facts', () => {
  const data: InsightData = {
    ...empty,
    sessions: [
      session('2026-10-17', {
        moduleId: 'l2',
        metrics: {
          catchShownLeft: 4,
          catchHitLeft: 3,
          catchShownRight: 4,
          catchHitRight: 4,
          confirmedAlignments: 2,
        },
        events: [{ at: '2026-10-17T10:01:00.000Z', type: 'step-up' }],
      }),
      session('2026-10-15', {
        moduleId: 'l2',
        // Both eyes reported (alignment confirmed) but the left symbols were missed: doubtful.
        metrics: {
          catchShownLeft: 4,
          catchHitLeft: 1,
          catchShownRight: 2,
          catchHitRight: 2,
          confirmedAlignments: 1,
        },
      }),
      session('2026-10-11', {
        moduleId: 'l1',
        actualMinutes: 5.5,
        metrics: { probesShown: 2, probesHit: 2 },
      }),
      // Last week.
      session('2026-10-09', {
        moduleId: 'l2',
        metrics: { catchShownLeft: 5, catchHitLeft: 2, catchShownRight: 5, catchHitRight: 5 },
      }),
      // Outside both weeks, and an unfinished session: ignored.
      session('2026-10-01'),
      session('2026-10-16', { status: 'in-progress' }),
    ],
  };
  const f = weeklyFacts(data, TODAY, name);

  it('counts this week and last week', () => {
    expect(f.period).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(f.thisWeek).toMatchObject({ sessions: 3, minutes: 25.5, daysTrained: 3 });
    expect(f.thisWeek.modules).toEqual([
      { moduleId: 'l2', name: 'Module l2', sessions: 2, minutes: 20 },
      { moduleId: 'l1', name: 'Module l1', sessions: 1, minutes: 5.5 },
    ]);
    expect(f.lastWeek).toEqual({ sessions: 1, minutes: 10, daysTrained: 1 });
    expect(f.change.sessions).toBe(2);
    expect(f.change.minutes).toBe(15.5);
  });

  it('summarizes the one-eye check points per eye, with the change from last week', () => {
    // Left: (3 + 1 + 2 chick probes) of (4 + 4 + 2) = 60 %; last week 2 of 5 = 40 %.
    expect(f.oneEyeChecks.left).toEqual({ seenPercent: 60, shown: 10 });
    expect(f.oneEyeChecks.right).toEqual({ seenPercent: 100, shown: 6 });
    expect(f.oneEyeChecks.lastWeekLeft).toEqual({ seenPercent: 40, shown: 5 });
    expect(f.change.leftSeenPoints).toBe(20);
    expect(f.change.rightSeenPoints).toBe(0);
    expect(f.oneEyeChecks.doubtfulSessions).toBe(1);
    expect(f.difficulty).toEqual({ raised: 1, loweredForComfort: 0 });
  });

  it('gives the model names and numbers only: no ids, dates or symptom details', () => {
    const m = JSON.stringify(factsForModel(f));
    expect(m).not.toContain('2026');
    expect(m).not.toContain('moduleId');
    expect(m).not.toContain('comfort');
    expect(m).toContain('Module l2');
  });

  it('lists the numbers a recap may use', () => {
    const allowed = allowedNumbers(f);
    for (const n of [3, 25.5, 60, 100, 40, 20, 15.5, 7]) expect(allowed.has(n)).toBe(true);
    expect(allowed.has(2026)).toBe(false);
    expect(allowed.has(61)).toBe(false);
  });
});

describe('recap gate', () => {
  const two = [session('2026-10-16'), session('2026-10-17')];
  const gate = (d: Partial<InsightData>) =>
    insightGate(weeklyFacts({ ...empty, sessions: two, ...d }, TODAY, name));

  it('needs at least two sessions in the week', () => {
    expect(insightGate(weeklyFacts({ ...empty, sessions: [two[0]!] }, TODAY, name))).toEqual({
      kind: 'too-little',
      sessions: 1,
      needed: 2,
    });
    expect(gate({})).toEqual({ kind: 'ok' });
  });

  it('switches off in weeks with double vision, moderate headache or warning symptoms', () => {
    expect(gate({ checks: [makeCheck({ at: '2026-10-16T10:15:00.000Z', diplopia: 2 })] }).kind).toBe(
      'safety',
    );
    expect(gate({ checks: [makeCheck({ at: '2026-10-16T10:15:00.000Z', headache: 2 })] }).kind).toBe(
      'safety',
    );
    const event = (type: 'red-flag' | 'diplopia-lock') => ({
      id: `e_${type}`,
      at: '2026-10-15T10:00:00.000Z',
      type,
      sessionId: null,
      details: '',
    });
    expect(gate({ safetyEvents: [event('red-flag')] }).kind).toBe('safety');
    expect(gate({ safetyEvents: [event('diplopia-lock')] }).kind).toBe('safety');
    // Mild symptoms, or symptoms from an earlier week, do not.
    expect(
      gate({ checks: [makeCheck({ at: '2026-10-16T10:15:00.000Z', diplopia: 1, headache: 1 })] }).kind,
    ).toBe('ok');
    expect(gate({ checks: [makeCheck({ at: '2026-10-01T10:15:00.000Z', diplopia: 4 })] }).kind).toBe('ok');
  });
});

const F = EVAL_CASES.find((c) => c.id === 'left-up')!.facts; // 5 sessions, 52.5 min, left 70 %, right 100 %

const GOOD: Draft[] = [
  {
    headline: '5 sessions and 52.5 minutes this week',
    points: [
      'You trained on 4 of the last 7 days, one more session than last week.',
      'On the left you reported seeing 70% of the one-eye check points, up 30 percentage points from 40%.',
      'Line Them Up took all of your time (L2).',
    ],
    suggestion: 'Keep the same calm routine and take the breaks the app offers.',
  },
  {
    headline: 'A steady week',
    points: ['You did 5 sessions.'],
    suggestion: 'Check that the glasses sit straight before you start.',
  },
];

/** Drafts the guardrails must stop, with the rule that should catch each. */
const BAD: Array<[string, Partial<Draft>]> = [
  ['wording:diagnosis', { points: ['This pattern suggests a diagnosis of reduced binocularity.'] }],
  ['wording:cure', { suggestion: 'Keep going and this could be cured.' }],
  ['wording:treatment', { points: ['Your therapy is going well.'] }],
  ['wording:condition-name', { points: ['Good progress for someone with amblyopia.'] }],
  ['wording:condition-name', { points: ['Your lazy eye joined in more often.'] }],
  ['wording:suppression-claim', { points: ['Your left eye is less suppressed than before.'] }],
  ['wording:eye-judgement', { points: ['Your weak eye saw 70% of the symbols.'] }],
  ['wording:vision-claim', { headline: 'Your vision is improving' }],
  ['wording:vision-claim', { points: ['Your eyesight got better this week.'] }],
  ['wording:promise', { suggestion: 'Stick with it and your eyes will improve.' }],
  ['wording:overtraining', { suggestion: 'Try to train longer next week.' }],
  ['wording:overtraining', { suggestion: 'Push through any discomfort to keep the streak.' }],
  ['wording:medical', { suggestion: 'Ask for a new prescription.' }],
  ['number:75', { points: ['You reported seeing 75% on the left.'] }],
  ['number:13.5', { points: ['That is 13.5 more minutes than last week.'] }],
  ['number:2026', { headline: 'Your October 2026 recap' }],
  ['length:headline', { headline: 'x'.repeat(130) }],
  ['count:points', { points: [] }],
  ['count:points', { points: ['a', 'b', 'c', 'd'] }],
  ['empty:suggestion', { suggestion: ' ' }],
];

describe('guardrails', () => {
  it('accept factual, neutral drafts', () => {
    for (const d of GOOD) expect(checkDraft(d, F)).toEqual([]);
  });

  it.each(BAD)('reject %s', (rule, change) => {
    expect(checkDraft({ ...GOOD[0]!, ...change }, F)).toContain(rule);
  });

  it('reject anything that is not a draft', () => {
    for (const bad of [null, 'text', { headline: 'x' }, { headline: 'x', points: [1], suggestion: 'y' }])
      expect(checkDraft(bad, F)).toEqual(['shape']);
  });

  it('check Chinese text with Chinese rules', () => {
    const zh: Draft = {
      headline: '本周 5 次训练，共 52.5 分钟',
      points: ['左眼报告看到 70%。'],
      suggestion: '下次训练前检查眼镜是否戴正。',
    };
    expect(checkDraft(zh, F, 'zh')).toEqual([]);
    expect(checkDraft({ ...zh, points: ['弱视有所改善。'] }, F, 'zh')).toContain('wording:condition-name');
    expect(checkDraft({ ...zh, points: ['您的视力提高了。'] }, F, 'zh')).toContain('wording:vision-claim');
    expect(checkDraft({ ...zh, suggestion: '下周加练 80 分钟。' }, F, 'zh')).toEqual(
      expect.arrayContaining(['wording:overtraining', 'number:80']),
    );
  });

  it('read module codes as labels, not numbers', () => {
    expect(numbersIn('L1 and L5 took 12.5 minutes, 3 sessions')).toEqual([12.5, 3]);
  });

  it('describe problems in plain words for the retry', () => {
    const text = describeProblems(['number:75', 'wording:eye-judgement', 'length:point', 'shape']);
    expect(text).toContain('the number 75 is not in the facts');
    expect(text).toContain('avoid eye judgement wording');
    expect(text).toContain('the point is too long');
    expect(text).toContain('JSON object only');
  });
});

describe('rule-based recap', () => {
  it.each(EVAL_CASES.map((c) => [c.id, c.facts] as const))(
    '%s passes its own guardrails in English and Chinese',
    (_id, facts) => {
      expect(checkDraft(templateDraft(facts, i18n.getFixedT('en')), facts, 'en')).toEqual([]);
      expect(checkDraft(templateDraft(facts, i18n.getFixedT('zh-Hans')), facts, 'zh')).toEqual([]);
    },
  );

  it('says what this week calls for', () => {
    const en = i18n.getFixedT('en');
    const doubtful = EVAL_CASES.find((c) => c.id === 'doubtful')!.facts;
    const l1 = EVAL_CASES.find((c) => c.id === 'l1-only')!.facts;
    const none = EVAL_CASES.find((c) => c.id === 'no-checks')!.facts;
    expect(templateDraft(doubtful, en).points.join(' ')).toContain('did not quite match: 2');
    expect(templateDraft(doubtful, en).suggestion).toContain('glasses');
    expect(templateDraft(l1, en).points.join(' ')).toContain('left eye');
    expect(templateDraft(l1, en).points.join(' ')).not.toContain('right');
    expect(templateDraft(none, en).points.join(' ')).toContain('No one-eye check points');
    for (const c of EVAL_CASES) {
      const d = templateDraft(c.facts, en);
      expect(softChecks(c.facts, d).filter((s) => !s.passed)).toEqual([]);
    }
  });
});

/** A scripted stand-in for the on-device model. */
function scripted(...answers: unknown[]): Writer & { calls: Array<string | undefined> } {
  const calls: Array<string | undefined> = [];
  return {
    calls,
    write: (_f, problems) => {
      calls.push(problems);
      const next = answers.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    destroy: () => {},
  };
}

const deps = (writer: Writer | null, extra: Partial<Parameters<typeof runInsight>[2]> = {}) => ({
  lang: 'en' as const,
  template: (f: typeof F) => templateDraft(f, i18n.getFixedT('en')),
  writer,
  now: () => 0,
  ...extra,
});

describe('recap pipeline', () => {
  const good = GOOD[0]!;
  const bad = { ...good, points: ['Your weak eye saw 75%.'] };

  it('shows a draft that passes the guardrails', async () => {
    const w = scripted(good);
    const r = await runInsight(F, { kind: 'ok' }, deps(w));
    expect(r).toMatchObject({ source: 'model', attempts: 1, problems: [] });
    expect(r.draft.points).toEqual(good.points);
    // The suggestion is the rule-based one, not the model's.
    expect(r.draft.suggestion).toBe(templateDraft(F, i18n.getFixedT('en')).suggestion);
  });

  it('retries once with the problems spelled out', async () => {
    const w = scripted(bad, good);
    const r = await runInsight(F, { kind: 'ok' }, deps(w));
    expect(r).toMatchObject({ source: 'model', attempts: 2 });
    expect(r.problems).toEqual([['wording:eye-judgement', 'number:75', 'unit:percent:75']]);
    expect(w.calls[1]).toContain('the number 75 is not in the facts');
  });

  it('falls back to the rule-based recap after two failed drafts or an error', async () => {
    const r = await runInsight(F, { kind: 'ok' }, deps(scripted(bad, 'not json')));
    expect(r).toMatchObject({ source: 'template', reason: 'checks-failed', attempts: 2 });
    expect(r.problems[1]).toEqual(['shape']);
    expect(r.draft.headline).toContain('5 sessions');
    const e = await runInsight(
      F,
      { kind: 'ok' },
      deps(scripted(new Error('model crashed'), new Error('model crashed again'))),
    );
    expect(e).toMatchObject({ source: 'template', reason: 'error', attempts: 2 });
    expect(e.errors).toEqual(['Error: model crashed', 'Error: model crashed again']);
  });

  it('counts a failed call as an attempt and starts the retry from the facts', async () => {
    const w = scripted(new Error('session lost'), good);
    const r = await runInsight(F, { kind: 'ok' }, deps(w));
    expect(r).toMatchObject({ source: 'model', attempts: 2, problems: [['error:Error']] });
    expect(w.calls).toEqual([undefined, undefined]); // no corrective feedback after an error
  });

  it('gives up on a call that hangs, instead of waiting for minutes', async () => {
    const hang: Writer = { write: () => new Promise(() => {}), destroy: () => {} };
    const r = await runInsight(F, { kind: 'ok' }, deps(hang, { timeoutMs: 20 }));
    expect(r).toMatchObject({ source: 'template', reason: 'timeout', attempts: 2 });
    expect(r.problems).toEqual([['timeout:TimeoutError'], ['timeout:TimeoutError']]);
    expect(r.errors[0]).toMatch(/^TimeoutError: No answer within/);
  });

  it('still stops at once when the user leaves the page', async () => {
    const controller = new AbortController();
    const hang: Writer = { write: () => new Promise(() => {}), destroy: () => {} };
    const pending = runInsight(
      F,
      { kind: 'ok' },
      deps(hang, { signal: controller.signal, timeoutMs: 10_000 }),
    );
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it('never calls the model when the gate is closed or there is no model', async () => {
    const w = scripted(good);
    expect((await runInsight(F, { kind: 'safety' }, deps(w))).reason).toBe('safety');
    expect((await runInsight(F, { kind: 'too-little', sessions: 1, needed: 2 }, deps(w))).reason).toBe(
      'too-little',
    );
    expect(w.calls).toEqual([]);
    expect((await runInsight(F, { kind: 'ok' }, deps(null))).reason).toBe('no-model');
  });

  it('translates to Chinese and checks the translation too', async () => {
    const zhT = i18n.getFixedT('zh-Hans');
    const dict: Record<string, string> = {
      [good.headline]: '本周 5 次训练，共 52.5 分钟',
      [good.points[0]!]: '过去 7 天里您训练了 4 天。',
      [good.points[1]!]: '左眼报告看到 70%，比上周的 40% 高了 30 个百分点。',
      [good.points[2]!]: '「对齐」占用了全部时间（L2）。',
    };
    const translator = (map: (s: string) => string): TextTranslator => ({
      translate: (s) => Promise.resolve(map(s)),
      destroy: () => {},
    });
    const zhDeps = (tr: TextTranslator | null) =>
      deps(scripted(good), { lang: 'zh', template: (f) => templateDraft(f, zhT), translator: tr });

    const ok = await runInsight(F, { kind: 'ok' }, zhDeps(translator((s) => dict[s] ?? s)));
    expect(ok).toMatchObject({ source: 'model', englishDraft: { headline: good.headline } });
    expect(ok.draft.suggestion).toBe(templateDraft(F, zhT).suggestion);
    expect(ok.draft.headline).toBe('本周 5 次训练，共 52.5 分钟');

    const drift = await runInsight(F, { kind: 'ok' }, zhDeps(translator((s) => `${dict[s] ?? s}弱视`)));
    expect(drift).toMatchObject({
      source: 'template',
      reason: 'translation-failed',
      englishDraft: { headline: good.headline },
    });
    expect(drift.draft.headline).toContain('过去 7 天');

    const none = await runInsight(F, { kind: 'ok' }, zhDeps(null));
    expect(none).toMatchObject({
      source: 'template',
      reason: 'no-translator',
      englishDraft: { headline: good.headline },
    });
  });
});

/**
 * Real outputs of Chrome's on-device model from the first evaluation run (prompt v1,
 * 2026-10-17). All passed the v1 guardrails; a manual review found these wrong. v2 must
 * reject them, and must still accept the ones that were fine.
 */
describe('regressions from the first real evaluation', () => {
  const facts = (id: string) => EVAL_CASES.find((c) => c.id === id)!.facts;
  const withTip = (id: string, d: Omit<Draft, 'suggestion'>): Draft => ({
    ...d,
    suggestion: templateDraft(facts(id), i18n.getFixedT('en')).suggestion,
  });

  it.each([
    [
      'false-alarms',
      {
        headline: 'Consistent practice this week helps maintain skill.',
        points: ['You trained for 3 days this week, completing 30 minutes of sessions each day.'],
      },
      ['claim:per-day', 'missing:mismatch', 'wording:outcome'],
    ],
    [
      'many-modules',
      {
        headline: 'Consistent Practice This Week! Keep a Comfortable Routine.',
        points: [
          "You trained for 5 days this week, completing 7 sessions and 72 minutes. You worked on several modules, including 'Line Them Up' and 'Don't Lose the Left.'",
          'You reported seeing 6 points with your left eye and 3 points with your right eye this week.',
        ],
      },
      ['unit:points:6', 'unit:points:3'],
    ],
    [
      'big-drop',
      {
        headline: 'Consistent practice this week. Keep up the good work!',
        points: [
          'You trained for 1 day this week, completing 2 sessions totaling 16 minutes. You reported seeing 75% of the left eye checks and 100% of the right eye checks.',
        ],
      },
      ['framing:praise-light-week'],
    ],
    [
      'big-rise',
      {
        headline: 'Good progress this week! Consistent training and engaging modules.',
        points: ['You trained for 7 days this week, totaling 95 minutes across 9 sessions.'],
      },
      ['wording:outcome'],
    ],
  ] as const)('%s is rejected', (id, draft, rules) => {
    expect(checkDraft(withTip(id, { ...draft, points: [...draft.points] }), facts(id))).toEqual(
      expect.arrayContaining([...rules]),
    );
  });

  it('accepts the outputs that were right', () => {
    const steady = withTip('steady', {
      headline: 'Consistent Practice This Week with Focus on Both Eyes',
      points: [
        "You trained for 5 days this week, totaling 60 minutes of sessions. You worked on 'Line Them Up' for 40 minutes and 'Both Eyes On' for 20 minutes.",
        'You reported seeing 90% when a symbol was shown to each eye. Last week, these percentages were 89%.',
      ],
    });
    const leftUp = withTip('left-up', {
      headline: 'Consistent Training This Week – Keep Up the Good Work!',
      points: [
        'You trained for 4 days this week, completing 5 sessions totaling 52.5 minutes.',
        'You reported seeing 70% of the left eye checks this week, up from 40% last week.',
      ],
    });
    const reading = withTip('reading', {
      headline: 'Consistent Training This Week: Practicing Two-Eye Coordination',
      points: [
        'You trained for 3 days this week, spending 28 minutes on Two-Eye Reading modules.',
        'This week you had 2 more sessions than last week, totaling 3 sessions.',
      ],
    });
    expect(checkDraft(steady, facts('steady'))).toEqual([]);
    expect(checkDraft(leftUp, facts('left-up'))).toEqual([]);
    expect(checkDraft(reading, facts('reading'))).toEqual([]);
  });

  it('strips Markdown the model added', () => {
    const raw = JSON.stringify({
      headline: '**3** days',
      points: ['You trained for **3** days, spending a total of **27.3** minutes.'],
    });
    expect(parseDraft(raw)).toEqual({
      headline: '3 days',
      points: ['You trained for 3 days, spending a total of 27.3 minutes.'],
    });
  });

  it('gives the model labelled sentences, each number with its unit', () => {
    const lines = factSentences(facts('many-modules'));
    expect(lines).toContain('Sessions this week: 7 (last week: 5; up 2).');
    expect(lines).toContain(
      'Left eye: the user reported seeing 86% of the check symbols shown only to the left eye (last week 80%; up 6 percentage points).',
    );
    const l1 = factSentences(facts('l1-only'));
    expect(l1).toContain('Right eye: no check symbols were shown this week. Do not mention the right eye.');
    expect(l1).toContain(
      'Training happened on only 2 days this week: describe it plainly, without praise such as "consistent".',
    );
    expect(factSentences(facts('doubtful')).join(' ')).toContain('Reports that did not match: in 2 sessions');
    expect(factSentences(facts('big-drop')).join(' ')).toContain('far fewer sessions than last week');
  });
});

/** Real outputs from the second evaluation run (prompt v2, 2026-10-18). */
describe('regressions from the second real evaluation', () => {
  const facts = (id: string) => EVAL_CASES.find((c) => c.id === id)!.facts;
  const withTip = (id: string, d: Omit<Draft, 'suggestion'>): Draft => ({
    ...d,
    suggestion: templateDraft(facts(id), i18n.getFixedT('en')).suggestion,
  });

  it('rejects a mismatch that did not happen, a cut-off headline and measurement wording', () => {
    const leftDown = withTip('left-down', {
      headline: 'Week of 4 Sessions: Reduced Training Time, Some Reporting Mismatches',
      points: ["This week included 4 sessions, a decrease of 1 from the previous week's 5 sessions."],
    });
    const perfect = withTip('perfect', {
      headline: 'Week of',
      points: ["You completed 5 sessions this week, matching last week's total of 5 sessions."],
    });
    const steady = withTip('steady', {
      headline: 'Line Them Up and Both Eyes On Modules Trained This Week',
      points: [
        "Reports indicate that the left eye's symbol recognition increased by 1 percentage point this week, reporting 90% accuracy.",
      ],
    });
    expect(checkDraft(leftDown, facts('left-down'))).toContain('claim:mismatch');
    expect(checkDraft(perfect, facts('perfect'))).toEqual(['incomplete:headline']); // "matching" is not a claim
    expect(checkDraft(steady, facts('steady'))).toEqual(['wording:measurement']);
  });

  it('accepts the v2 outputs that were right, including week-over-week changes', () => {
    const bigDrop = withTip('big-drop', {
      headline: 'Line Them Up Module: Fewer Sessions This Week',
      points: [
        "This week included 2 sessions of the 'Line Them Up' module, totaling 16 minutes of training time.",
        'You trained for 1 of the last 7 days this week, compared to 6 days last week.',
        'The left eye reported seeing 75% of the check symbols, down 4 percentage points from last week, while the right eye reported 100%.',
      ],
    });
    const manyModules = withTip('many-modules', {
      headline: 'More Sessions and Minutes Spent Training This Week',
      points: [
        'You increased your training sessions to 7 this week, up from 5 last week.',
        'Reports from this week show the right eye seeing 93% of the check symbols, an increase of 3 percentage points from the previous week. The left eye reporting 86% of check symbols were seen, up 6 percentage points.',
      ],
    });
    const falseAlarms = withTip('false-alarms', {
      headline: 'Stretch Module: Consistent Sessions and Time This Week',
      points: [
        "In 3 sessions, there were reports that didn't match, but the difficulty level remained the same.",
      ],
    });
    expect(checkDraft(bigDrop, facts('big-drop'))).toEqual([]);
    expect(checkDraft(manyModules, facts('many-modules'))).toEqual([]);
    expect(checkDraft(falseAlarms, facts('false-alarms'))).toEqual([]);
  });
});

describe('model output parsing', () => {
  it('reads JSON, with or without a code fence', () => {
    const d = { headline: 'h', points: ['p'], suggestion: 's' };
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
    expect(parseDraft('```json\n' + JSON.stringify(d) + '\n```')).toEqual(d);
    expect(parseDraft('Sure! Here is your recap.')).toBeNull();
  });
});

describe('evaluation set', () => {
  it('has self-consistent facts', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) {
      const f = c.facts;
      expect(insightGate(f)).toEqual({ kind: 'ok' });
      const moduleMinutes = f.thisWeek.modules.reduce((a, m) => a + m.minutes, 0);
      expect(Math.round(moduleMinutes * 10) / 10).toBe(f.thisWeek.minutes);
      expect(f.thisWeek.modules.reduce((a, m) => a + m.sessions, 0)).toBe(f.thisWeek.sessions);
    }
  });

  it('hard-rejects a recap that ignores a mismatch or invents a right-eye result', () => {
    const doubtful = evalFacts({
      sessions: 2,
      minutes: 20,
      days: 2,
      modules: [['l1', 2, 20]],
      left: [4, 2],
      doubtful: 1,
    });
    const silent: Draft = {
      headline: '2 sessions',
      points: ['Your right eye did well.'],
      suggestion: 'Rest.',
    };
    expect(checkDraft(silent, doubtful)).toEqual(
      expect.arrayContaining(['missing:mismatch', 'claim:absent-eye']),
    );
    // Quality checks: a generic headline is flagged.
    const generic = softChecks(doubtful, { ...silent, headline: 'Consistent practice this week' });
    expect(generic.find((c) => c.id === 'specific-headline')?.passed).toBe(false);
  });
});

describe('headline completeness', () => {
  it('does not mistake a module name ending in "On" for a cut-off headline', () => {
    const f = EVAL_CASES.find((c) => c.id === 'steady')!.facts;
    const d: Draft = {
      headline: 'Practice This Week: Line Them Up & Both Eyes On',
      points: ['You completed 6 sessions this week.'],
      suggestion: templateDraft(f, i18n.getFixedT('en')).suggestion,
    };
    expect(checkDraft(d, f)).toEqual([]);
    expect(checkDraft({ ...d, headline: 'Six sessions with' }, f)).toEqual(['incomplete:headline']);
  });
});
