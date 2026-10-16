import { useTranslation } from 'react-i18next';
import { LineChart } from '../dashboard/charts';
import { shortDate } from '../dashboard/trends';
import { localeTag } from '../dashboard/TrendsSection';
import { csvCell } from '../data/sanitize';
import type { Assessment } from '../data/schema';
import { baseline, completedChecks, measuresOf, type CheckMeasures } from './checkLogic';

type Key = 'alignmentDelta' | 'balancePercent' | 'stereoArcsec';

const FORMAT: Record<Key, (v: number) => string> = {
  alignmentDelta: (v) => `${v.toFixed(2)}Δ`,
  balancePercent: (v) => `${Math.round(v)}%`,
  stereoArcsec: (v) => `${Math.round(v)}″`,
};

const MEASURE_KEY: Record<Key, string> = {
  alignmentDelta: 'alignment',
  balancePercent: 'balance',
  stereoArcsec: 'stereo',
};

/** One point per completed check, in date order. */
export function checkSeries(assessments: Assessment[], key: Key, locale: string) {
  return completedChecks(assessments).map((a) => ({
    label: shortDate(a.at, locale),
    value: measuresOf(a)[key],
  }));
}

/**
 * Weekly-check results: the measurement, kept apart from in-game training scores.
 * Table: baseline (first two checks), latest, number of checks; then one chart per measure.
 */
export function CheckTrends({ assessments, charts = true }: { assessments: Assessment[]; charts?: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = localeTag(i18n.language);
  const done = completedChecks(assessments);
  if (done.length === 0) return <p className="hint">{t('check.noneYet')}</p>;
  const base = baseline(assessments);
  const latest = measuresOf(done[done.length - 1]!);
  const keys: Key[] = ['alignmentDelta', 'balancePercent', 'stereoArcsec'];
  const show = (m: CheckMeasures | null, k: Key) => {
    const v = m?.[k];
    return v === null || v === undefined || !Number.isFinite(v) ? '—' : FORMAT[k](v);
  };
  return (
    <div data-testid="check-trends">
      <table>
        <thead>
          <tr>
            <th>{t('report.measure')}</th>
            <th>{t('check.baseline')}</th>
            <th>{t('report.latest')}</th>
            <th>{t('check.count')}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td>
                {t(`check.measures.${MEASURE_KEY[k]}`)}
                {k !== 'balancePercent' ? <span className="hint"> {t('report.lowerBetter')}</span> : null}
              </td>
              <td>{show(base, k)}</td>
              <td>{show(latest, k)}</td>
              <td>{done.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{t('check.meaning')}</p>
      {charts ? (
        <div className="charts">
          {keys.map((k) => (
            <LineChart
              key={k}
              title={t(`check.measures.${MEASURE_KEY[k]}`)}
              subtitle={t(`check.chartSub.${MEASURE_KEY[k]}`)}
              series={[
                { name: t(`check.measures.${MEASURE_KEY[k]}`), points: checkSeries(assessments, k, locale) },
              ]}
              format={FORMAT[k]}
              testId={`chart-check-${MEASURE_KEY[k]}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function assessmentsToCsv(assessments: Assessment[]): string {
  const header = [
    'at',
    'status',
    'worthDots',
    'worthResult',
    'alignmentMeanDelta',
    'alignmentSpreadDelta',
    'balancePercent',
    'stereoThresholdArcsec',
    'stereoTrials',
    'viewingDistanceCm',
  ];
  const rows = [...assessments]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((a) =>
      [
        a.at,
        a.status,
        a.worth?.dotsSeen ?? '',
        a.worth?.result ?? '',
        a.alignment?.meanDelta ?? '',
        a.alignment?.spreadDelta ?? '',
        a.balance ? Math.round(a.balance.ratio * 100) : '',
        a.stereo?.thresholdArcsec ?? '',
        a.stereo?.trials ?? '',
        a.viewingDistanceCm,
      ]
        .map(csvCell)
        .join(','),
    );
  return [header.join(','), ...rows].join('\n');
}
