import { useTranslation } from 'react-i18next';
import { FREQUENCY_LABELS, type SessionRecord, type SymptomCheck } from '../data/schema';
import { BarChart, LineChart } from './charts';
import { diplopiaTimeline, metric, minutesPerDay, pairedSeries, perSession } from './trends';

export function localeTag(lng: string): string {
  return lng === 'zh-Hans' ? 'zh-CN' : 'en-GB';
}

/** Progress charts: one measure per chart, single y-axis each. */
export function TrendsSection({
  sessions,
  checks,
  dailyCap,
  days = 28,
}: {
  sessions: SessionRecord[];
  checks: SymptomCheck[];
  dailyCap: number;
  days?: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = localeTag(i18n.language);
  const pct = (v: number) => `${Math.round(v)}%`;
  const delta = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}Δ`;

  return (
    <div className="charts" data-testid="trends">
      <BarChart
        title={t('trends.minutes', { days })}
        subtitle={t('trends.minutesSub')}
        points={minutesPerDay(sessions, days)}
        format={(v) => `${Math.round(v)}`}
        reference={{ value: dailyCap, label: t('trends.dailyLimit', { cap: dailyCap }) }}
        testId="chart-minutes"
      />
      <LineChart
        title={t('trends.balance')}
        subtitle={t('trends.balanceSub')}
        series={[
          {
            name: t('trends.balance'),
            points: perSession(sessions, 'l1', (s) => s.intensityValue * 100, locale),
          },
        ]}
        format={pct}
        yDomain={[0, 100]}
        testId="chart-balance"
      />
      <LineChart
        title={t('trends.offset')}
        subtitle={t('trends.offsetSub')}
        series={[
          {
            name: t('trends.offset'),
            points: perSession(sessions, 'l2', metric('meanResidualDelta'), locale),
          },
        ]}
        format={delta}
        testId="chart-offset"
      />
      <LineChart
        title={t('trends.catchRate')}
        subtitle={t('trends.catchRateSub')}
        series={[
          {
            name: t('trends.catchRate'),
            points: perSession(sessions, 'l3', (s) => (s.metrics['catchRate'] ?? NaN) * 100, locale),
          },
        ]}
        format={pct}
        yDomain={[0, 100]}
        testId="chart-catch"
      />
      <LineChart
        title={t('trends.vergence')}
        subtitle={t('trends.vergenceSub')}
        series={pairedSeries(
          sessions,
          'l4',
          { name: t('trends.break'), key: 'meanBreakBO' },
          { name: t('trends.recovery'), key: 'meanRecoveryBO' },
          locale,
        )}
        format={delta}
        testId="chart-vergence"
      />
      <LineChart
        title={t('trends.stereo')}
        subtitle={t('trends.stereoSub')}
        series={[
          {
            name: t('trends.stereo'),
            points: perSession(sessions, 'l5', metric('stereoThresholdArcsec'), locale),
          },
        ]}
        format={(v) => `${Math.round(v)}″`}
        testId="chart-stereo"
      />
      <LineChart
        title={t('trends.diplopia')}
        subtitle={t('trends.diplopiaSub')}
        series={[{ name: t('trends.diplopia'), points: diplopiaTimeline(checks, locale) }]}
        format={(v) => t(`symptoms.frequency.${FREQUENCY_LABELS[Math.round(v)] ?? 'never'}`)}
        yDomain={[0, 4]}
        testId="chart-diplopia"
      />
    </div>
  );
}
