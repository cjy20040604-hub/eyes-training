import { useTranslation } from 'react-i18next';
import { seenRate, sessionCatch, summarizeConsistency, type EyeCatch } from '../data/consistency';
import type { SessionRecord } from '../data/schema';
import { getModule } from '../modules/registry';
import { LineChart } from './charts';
import { shortDate } from './trends';
import { localeTag } from './TrendsSection';

const pct = (e: EyeCatch) => {
  const r = seenRate(e);
  return r === null ? '—' : `${e.seen}/${e.shown} (${Math.round(r * 100)}%)`;
};

/** Points: share of the left / right eye's ◇ seen in each session that showed any. */
export function catchSeries(sessions: SessionRecord[], eye: 'left' | 'right', locale: string) {
  return [...sessions]
    .filter((s) => s.status === 'completed' || s.status === 'stopped')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .filter((s) => sessionCatch(s)[eye].shown > 0)
    .map((s) => {
      const r = seenRate(sessionCatch(s)[eye]);
      return { label: shortDate(s.startedAt, locale), value: r === null ? null : Math.round(r * 100) };
    });
}

/**
 * Report consistency: one-eye-only check points seen per eye, presses without a symbol, and
 * sessions whose reports did not match. Descriptive only.
 */
export function ConsistencySection({
  sessions,
  chart = true,
}: {
  sessions: SessionRecord[];
  chart?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = localeTag(i18n.language);
  const sum = summarizeConsistency(sessions);
  const shown = sum.left.shown + sum.right.shown;
  if (shown === 0 && sum.falseAlarms === 0) return <p className="hint">{t('consistency.none')}</p>;
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  return (
    <div data-testid="consistency">
      <p className="hint">{t('consistency.intro')}</p>
      <dl className="kv">
        <dt>{t('consistency.leftSeen')}</dt>
        <dd data-testid="consistency-left">{pct(sum.left)}</dd>
        <dt>{t('consistency.rightSeen')}</dt>
        <dd data-testid="consistency-right">{pct(sum.right)}</dd>
        <dt>{t('consistency.falseAlarms')}</dt>
        <dd>{sum.falseAlarms}</dd>
        <dt>{t('consistency.flagged')}</dt>
        <dd data-testid="consistency-flagged">
          {t('consistency.flaggedValue', { n: sum.flagged.length, of: sum.sessions })}
        </dd>
      </dl>
      {sum.flagged.length ? (
        <table>
          <thead>
            <tr>
              <th>{t('history.date')}</th>
              <th>{t('history.module')}</th>
              <th>{t('consistency.why')}</th>
            </tr>
          </thead>
          <tbody>
            {sum.flagged.slice(0, 8).map(({ session, reasons }) => (
              <tr key={session.id}>
                <td>{fmt.format(new Date(session.startedAt))}</td>
                <td>{getModule(session.moduleId).code}</td>
                <td>{reasons.map((r) => t(`consistency.reasons.${r}`)).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {chart ? (
        <LineChart
          title={t('consistency.chartTitle')}
          subtitle={t('consistency.chartSub')}
          series={[
            { name: t('consistency.leftEye'), points: catchSeries(sessions, 'left', locale) },
            { name: t('consistency.rightEye'), points: catchSeries(sessions, 'right', locale) },
          ]}
          format={(v) => `${Math.round(v)}%`}
          yDomain={[0, 100]}
          testId="chart-catch-seen"
        />
      ) : null}
    </div>
  );
}
