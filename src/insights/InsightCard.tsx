import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, Progress } from '../ui';
import { factsForModel, insightGate, type InsightData } from './facts';
import type { Draft } from './guardrails';
import {
  createTranslator,
  createWriter,
  modelAvailability,
  translatorAvailability,
  type Availability,
  type TextTranslator,
} from './onDevice';
import { runInsight, type InsightResult } from './pipeline';
import { mustSayLines, templateDraft } from './template';
import { useWeeklyFacts } from './useWeeklyFacts';

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; step: 'download' | 'writing'; progress: number | null }
  | { kind: 'done'; result: InsightResult };

const usable = (a: Availability) => a !== 'unsupported' && a !== 'unavailable';

function Recap({ draft, testId }: { draft: Draft; testId?: string }) {
  const { t } = useTranslation();
  return (
    <div className="insight-text" data-testid={testId}>
      <h3>{draft.headline}</h3>
      <ul>
        {draft.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p>
        <strong>{t('insights.tip')}</strong> {draft.suggestion}
      </p>
    </div>
  );
}

/**
 * Weekly recap. Always shows the rule-based version; with the browser's built-in model the
 * user can have it rewritten in plain language, on this device, checked against the numbers.
 */
export function InsightCard({ data, focus }: { data: InsightData | null; focus?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'zh-Hans' ? 'zh' : 'en';
  const facts = useWeeklyFacts(data);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  // Arriving from the overview's recap card: bring the recap into view once it has rendered.
  useEffect(() => {
    if (!focus || !facts || focused.current || !box.current) return;
    focused.current = true;
    box.current.scrollIntoView?.({ block: 'start' });
    box.current.focus({ preventScroll: true });
  }, [focus, facts]);

  useEffect(() => {
    let active = true;
    void modelAvailability().then((a) => active && setAvailability(a));
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, []);

  if (!facts) return null;
  const gate = insightGate(facts);

  async function generate() {
    if (!facts) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const progress = (p: number) => setPhase({ kind: 'running', step: 'download', progress: p });
    setPhase({ kind: 'running', step: 'writing', progress: null });
    // Created straight from the click, before any await: a first-time download needs the
    // click's user activation.
    const writerP = createWriter(progress).catch(() => null);
    const translatorP: Promise<TextTranslator | null> =
      lang === 'zh'
        ? translatorAvailability()
            .then((a) => (usable(a) ? createTranslator(progress) : null))
            .catch(() => null)
        : Promise.resolve(null);
    const [writer, translator] = await Promise.all([writerP, translatorP]);
    if (controller.signal.aborted) {
      writer?.destroy();
      translator?.destroy();
      return;
    }
    setPhase({ kind: 'running', step: 'writing', progress: null });
    try {
      const result = await runInsight(facts, gate, {
        lang,
        template: (f) => templateDraft(f, t),
        englishTemplate: (f) => templateDraft(f, i18n.getFixedT('en')),
        mustSay: (f) => mustSayLines(f, t),
        englishMustSay: (f) => mustSayLines(f, i18n.getFixedT('en')),
        writer,
        translator,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setPhase({ kind: 'done', result });
    } catch {
      /* aborted: the page was left */
    } finally {
      writer?.destroy();
      translator?.destroy();
    }
  }

  const done = phase.kind === 'done' ? phase.result : null;
  const ai = done?.source === 'model';
  const draft = done ? done.draft : templateDraft(facts, t);
  const failed = done && done.source === 'template' ? done.reason : undefined;

  return (
    <Card title={t('insights.title')} className="insight-card">
      <div data-testid="insight-card" id="weekly-recap" ref={box} tabIndex={-1}>
        <p className="hint">{t('insights.intro')}</p>
        {gate.kind === 'safety' ? (
          <div data-testid="insight-safety">
            <Banner tone="warn" title={t('insights.safetyTitle')}>
              {t('insights.safety')}
            </Banner>
          </div>
        ) : gate.kind === 'too-little' ? (
          <p data-testid="insight-too-little">
            {t('insights.tooLittle', { sessions: gate.sessions, needed: gate.needed })}
          </p>
        ) : (
          <>
            <p className="insight-source" data-testid="insight-source">
              <span className={`tag ${ai ? 'ai' : ''}`}>
                {ai
                  ? done.attempts > 1
                    ? t('insights.aiBadgeRetry')
                    : t('insights.aiBadge')
                  : t('insights.ruleBadge')}
              </span>
            </p>
            <Recap draft={draft} testId="insight-recap" />

            {failed && failed !== 'no-model' && failed !== 'safety' && failed !== 'too-little' ? (
              <div data-testid="insight-fallback">
                <Banner tone="info">
                  {t(`insights.fallback.${failed}`)}
                  {done?.problems.length ? (
                    <>
                      {' '}
                      <code>{done?.problems.flat().join(', ')}</code>
                    </>
                  ) : null}
                </Banner>
              </div>
            ) : null}
            {done?.englishDraft && !ai ? (
              <details>
                <summary>{t('insights.englishVersion')}</summary>
                <div lang="en">
                  <Recap draft={done.englishDraft} />
                </div>
              </details>
            ) : null}

            <div className="row no-print">
              {availability === null ? null : usable(availability) ? (
                <Button
                  variant="primary"
                  onClick={() => void generate()}
                  disabled={phase.kind === 'running'}
                  data-testid="insight-generate"
                >
                  {done ? t('insights.regenerate') : t('insights.generate')}
                </Button>
              ) : (
                <p className="hint" data-testid="insight-unsupported">
                  {t('insights.unsupported')}
                </p>
              )}
            </div>
            {availability === 'downloadable' && phase.kind === 'idle' ? (
              <p className="hint">{t('insights.downloadHint')}</p>
            ) : null}
            {phase.kind === 'running' ? (
              <div className="insight-progress" data-testid="insight-running">
                <p className="hint">
                  {phase.step === 'download'
                    ? t('insights.downloading', { percent: Math.round((phase.progress ?? 0) * 100) })
                    : t('insights.writing')}
                </p>
                {phase.step === 'download' ? (
                  <Progress value={phase.progress ?? 0} label={t('insights.downloadLabel')} />
                ) : null}
              </div>
            ) : null}

            <details className="no-print">
              <summary>{t('insights.factsTitle')}</summary>
              <p className="hint">{t('insights.factsHint')}</p>
              <pre className="insight-facts" data-testid="insight-facts">
                {JSON.stringify(factsForModel(facts), null, 2)}
              </pre>
            </details>
            <p className="hint">{t('insights.privacy')}</p>
          </>
        )}
      </div>
    </Card>
  );
}
