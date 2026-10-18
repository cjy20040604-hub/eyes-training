import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { insightGate, type InsightData } from './facts';
import { modelAvailability } from './onDevice';
import { templateDraft } from './template';
import { useWeeklyFacts } from './useWeeklyFacts';

/** Where the overview's link lands: the training summary, scrolled to the recap. */
const RECAP_LINK = { pathname: '/report', state: { focus: 'recap' } } as const;

/**
 * The weekly recap on the overview: this week's headline and one key point, and a link to
 * the full recap on the training summary page (where it can be rewritten by on-device AI).
 */
export function RecapTeaser({ data }: { data: InsightData | null }) {
  const { t } = useTranslation();
  const facts = useWeeklyFacts(data);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    let active = true;
    void modelAvailability().then((a) => {
      if (active) setAiReady(a !== 'unsupported' && a !== 'unavailable');
    });
    return () => {
      active = false;
    };
  }, []);

  if (!facts) return null;
  const gate = insightGate(facts);
  const draft = gate.kind === 'ok' ? templateDraft(facts, t) : null;

  return (
    <section className="goal-card" aria-labelledby="recap-card-title" data-testid="recap-teaser">
      <h2 className="section-title" id="recap-card-title">
        {t('insights.title')}
      </h2>
      {gate.kind === 'safety' ? (
        <p data-testid="recap-teaser-safety">{t('insights.teaserSafety')}</p>
      ) : gate.kind === 'too-little' ? (
        <p data-testid="recap-teaser-too-little">
          {t('insights.tooLittle', { sessions: gate.sessions, needed: gate.needed })}
        </p>
      ) : draft ? (
        <>
          <p data-testid="recap-teaser-text">
            <strong>{draft.headline}</strong>
            <br />
            {draft.points[1] ?? draft.points[0]}
          </p>
          {aiReady ? <p className="hint">{t('insights.teaserAi')}</p> : null}
        </>
      ) : null}
      {gate.kind !== 'too-little' ? (
        <Link
          className="btn"
          to={RECAP_LINK.pathname}
          state={RECAP_LINK.state}
          data-testid="recap-teaser-open"
        >
          {t('insights.teaserOpen')}
        </Link>
      ) : null}
    </section>
  );
}
