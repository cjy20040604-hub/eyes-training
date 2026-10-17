import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadText, safetyEventsToCsv, sessionsToCsv, symptomsToCsv } from '../data/exportImport';
import { useActiveCalibration, useAllData } from '../data/hooks';
import { FREQUENCY_LABELS, SEVERITY_LABELS, type SessionRecord } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { dayKey, dayKeyOffset } from '../data/util';
import { pxToPrismDiopters, round } from '../engine/units';
import { getModule } from '../modules/registry';
import { Banner, Button, Card, Segmented } from '../ui';
import { CheckTrends, assessmentsToCsv } from '../assessment/CheckTrends';
import { ConsistencySection } from './ConsistencySection';
import { TrendsSection } from './TrendsSection';
import { firstAndLatest, summarize } from './trends';

type Range = 30 | 90 | 0;

/**
 * One printable summary to bring to an orthoptist / ophthalmologist ("Print / save as PDF"),
 * plus CSV downloads. Everything is computed locally from this device's data.
 */
export function Report() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const all = useAllData();
  const { calibration } = useActiveCalibration();
  const [range, setRange] = useState<Range>(30);

  const sessions = all.data?.sessions ?? [];
  const checks = all.data?.checks ?? [];
  const events = all.data?.safetyEvents ?? [];
  const toKey = dayKey();
  const earliest = sessions.map((s) => s.day).sort()[0] ?? toKey;
  const fromKey = range === 0 ? earliest : dayKeyOffset(-(range - 1));
  const inRange = (s: SessionRecord) => s.day >= fromKey && s.day <= toKey;
  const rangeSessions = sessions.filter(inRange);
  const rangeChecks = checks.filter((c) => c.at.slice(0, 10) >= fromKey && c.at.slice(0, 10) <= toKey);
  const rangeEvents = events
    .filter((e) => e.at.slice(0, 10) >= fromKey && e.at.slice(0, 10) <= toKey)
    .sort((a, b) => a.at.localeCompare(b.at));
  const sum = summarize(sessions, checks, events, fromKey, toKey);
  const locale = i18n.language === 'zh-Hans' ? 'zh-CN' : 'en-GB';
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(iso),
    );
  const fmtDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const geometry = calibration
    ? { distanceM: calibration.viewingDistanceCm / 100, ppi: calibration.device.ppi }
    : null;
  const offsetDelta =
    calibration && geometry
      ? round(
          pxToPrismDiopters(Math.hypot(calibration.offset.left.dx, calibration.offset.left.dy), geometry),
          1,
        )
      : null;

  const measures: Array<{
    key: string;
    module: string;
    v: ReturnType<typeof firstAndLatest>;
    fmt: (n: number) => string;
    lowerIsBetter?: boolean;
  }> = [
    {
      key: 'balance',
      module: 'L1',
      v: firstAndLatest(rangeSessions, 'l1', (s) => s.intensityValue * 100),
      fmt: (n) => `${Math.round(n)}%`,
    },
    {
      key: 'offset',
      module: 'L2',
      v: firstAndLatest(rangeSessions, 'l2', (s) => s.metrics['meanResidualDelta']),
      fmt: (n) => `${n.toFixed(1)}Δ`,
      lowerIsBetter: true,
    },
    {
      key: 'catchRate',
      module: 'L3',
      v: firstAndLatest(rangeSessions, 'l3', (s) => (s.metrics['catchRate'] ?? NaN) * 100),
      fmt: (n) => `${Math.round(n)}%`,
    },
    {
      key: 'breakBO',
      module: 'L4',
      v: firstAndLatest(rangeSessions, 'l4', (s) => s.metrics['meanBreakBO']),
      fmt: (n) => `${n.toFixed(1)}Δ`,
    },
    {
      key: 'recoveryBO',
      module: 'L4',
      v: firstAndLatest(rangeSessions, 'l4', (s) => s.metrics['meanRecoveryBO']),
      fmt: (n) => `${n.toFixed(1)}Δ`,
    },
    {
      key: 'breakBI',
      module: 'L4',
      v: firstAndLatest(rangeSessions, 'l4', (s) => s.metrics['meanBreakBI']),
      fmt: (n) => `${n.toFixed(1)}Δ`,
    },
    {
      key: 'stereo',
      module: 'L5',
      v: firstAndLatest(rangeSessions, 'l5', (s) => s.metrics['stereoThresholdArcsec']),
      fmt: (n) => `${Math.round(n)}″`,
      lowerIsBetter: true,
    },
  ];

  const notableChecks = rangeChecks
    .filter(
      (c) =>
        c.diplopia > 0 || c.headache > 0 || c.nausea > 0 || c.eyestrain > 1 || c.confusion > 0 || c.notes,
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="report" data-testid="report">
      <div className="report-head">
        <div>
          <h1>{t('report.title')}</h1>
          <p className="hint">{t('report.subtitle')}</p>
          <p className="hint">
            {t('report.period', { from: fmtDate(fromKey), to: fmtDate(toKey) })}{' '}
            {t('report.generated', { date: fmtDate(new Date().toISOString()) })}
          </p>
        </div>
        <div className="row no-print">
          <Segmented
            value={range}
            onChange={setRange}
            label={t('report.range')}
            options={[
              { value: 30, label: t('report.last30') },
              { value: 90, label: t('report.last90') },
              { value: 0, label: t('report.allTime') },
            ]}
          />
          <Button variant="primary" onClick={() => window.print()} data-testid="report-print">
            {t('report.print')}
          </Button>
        </div>
      </div>
      <Banner tone="info">{t('report.disclaimer')}</Banner>

      <Card title={t('report.setupTitle')}>
        {calibration ? (
          <dl className="kv">
            <dt>{t('report.profile')}</dt>
            <dd>
              {calibration.name}, {fmtDate(calibration.updatedAt)}
            </dd>
            <dt>{t('report.viewing')}</dt>
            <dd>
              {t('report.viewingValue', { cm: calibration.viewingDistanceCm, ppi: calibration.device.ppi })}
            </dd>
            <dt>{t('report.clinicalPrism')}</dt>
            <dd>
              {calibration.clinicalPrism
                ? t('report.clinicalPrismValue', {
                    delta: calibration.clinicalPrism.amountDelta,
                    base: t(`calibration.prism.bases.${calibration.clinicalPrism.base}`),
                    range: t(`calibration.prism.${calibration.clinicalPrism.range}`),
                    date: calibration.clinicalPrism.measuredOn,
                    fusion: t(`calibration.prism.${calibration.clinicalPrism.fusionWithPrism}`),
                  })
                : t('report.none')}
            </dd>
            <dt>{t('report.virtualPrism')}</dt>
            <dd>
              {t('report.virtualPrismValue', {
                delta: offsetDelta ?? '—',
                dx: round(calibration.offset.left.dx, 1),
                dy: round(calibration.offset.left.dy, 1),
                rot: settings.cyclotorsionEnabled ? round(calibration.offset.left.rotationDeg, 1) : 0,
              })}
            </dd>
            <dt>{t('report.worth')}</dt>
            <dd>{t(`calibration.worth.results.${calibration.worthFourDot.result}`)}</dd>
            <dt>{t('report.balance')}</dt>
            <dd>
              {t('report.balanceValue', {
                value: Math.round(calibration.contrastBalance.balanceRatio * 100),
              })}
            </dd>
            <dt>{t('report.clinician')}</dt>
            <dd>{settings.clinicianAgreement ? t('report.clinicianOn') : t('report.clinicianOff')}</dd>
            {settings.clinicianNotes ? (
              <>
                <dt>{t('settings.clinicianNotes')}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{settings.clinicianNotes}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="hint">{t('overview.noCalibration')}</p>
        )}
      </Card>

      <Card title={t('report.adherenceTitle')}>
        <dl className="kv" data-testid="report-adherence">
          <dt>{t('report.daysTrained')}</dt>
          <dd>{t('report.daysTrainedValue', { days: sum.daysTrained, of: sum.daysInRange })}</dd>
          <dt>{t('report.sessions')}</dt>
          <dd>
            {t('report.sessionsValue', { n: sum.sessions, completed: sum.completed, stopped: sum.stopped })}
          </dd>
          <dt>{t('report.minutes')}</dt>
          <dd>{t('report.minutesValue', { n: Math.round(sum.minutes) })}</dd>
        </dl>
        {sum.perModule.length ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t('history.module')}</th>
                <th>{t('report.sessions')}</th>
                <th>{t('report.minutes')}</th>
              </tr>
            </thead>
            <tbody>
              {sum.perModule.map((m) => (
                <tr key={m.moduleId}>
                  <td>
                    {getModule(m.moduleId).code} {t(`modules.${m.moduleId}.name`)}
                  </td>
                  <td>{m.sessions}</td>
                  <td>{Math.round(m.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      <Card title={t('report.checksTitle')}>
        <div data-testid="report-checks">
          <p className="hint">{t('report.checksIntro')}</p>
          <CheckTrends
            assessments={(all.data?.assessments ?? []).filter((a) => a.day >= fromKey && a.day <= toKey)}
          />
        </div>
      </Card>

      <Card title={t('report.measuresTitle')}>
        <p className="hint">{t('report.measuresIntro')}</p>
        <table data-testid="report-measures">
          <thead>
            <tr>
              <th>{t('report.measure')}</th>
              <th>{t('report.first')}</th>
              <th>{t('report.latest')}</th>
              <th>{t('report.sessions')}</th>
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.key}>
                <td>
                  {m.module} {t(`report.measures.${m.key}`)}
                  {m.lowerIsBetter ? <span className="hint"> {t('report.lowerBetter')}</span> : null}
                </td>
                <td>{m.v ? m.fmt(m.v.first) : '—'}</td>
                <td>{m.v ? m.fmt(m.v.latest) : '—'}</td>
                <td>{m.v ? m.v.n : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={t('consistency.title')}>
        <div data-testid="report-consistency">
          <ConsistencySection sessions={rangeSessions} chart={false} />
        </div>
      </Card>

      <Card title={t('report.symptomsTitle')}>
        <dl className="kv">
          <dt>{t('report.diplopiaSessions')}</dt>
          <dd>{sum.diplopiaSessions}</dd>
          <dt>{t('report.headacheSessions')}</dt>
          <dd>{sum.headacheSessions}</dd>
          <dt>{t('report.stops')}</dt>
          <dd>{sum.stops}</dd>
          <dt>{t('report.redFlags')}</dt>
          <dd>{sum.redFlags}</dd>
          <dt>{t('report.flashPauses')}</dt>
          <dd>{sum.flashPauses}</dd>
        </dl>
        {notableChecks.length ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t('history.date')}</th>
                <th>{t('symptoms.diplopia')}</th>
                <th>{t('symptoms.headache')}</th>
                <th>{t('symptoms.nausea')}</th>
                <th>{t('symptoms.eyestrain')}</th>
                <th>{t('symptoms.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {notableChecks.map((c) => (
                <tr key={c.id}>
                  <td>
                    {fmtDateTime(c.at)} <span className="hint">{t(`report.phase.${c.phase}`)}</span>
                  </td>
                  <td>{t(`symptoms.frequency.${FREQUENCY_LABELS[c.diplopia]}`)}</td>
                  <td>{t(`symptoms.severity.${SEVERITY_LABELS[c.headache]}`)}</td>
                  <td>{t(`symptoms.severity.${SEVERITY_LABELS[c.nausea]}`)}</td>
                  <td>{t(`symptoms.severity.${SEVERITY_LABELS[c.eyestrain]}`)}</td>
                  <td>{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">{t('report.noSymptoms')}</p>
        )}
        {rangeEvents.length ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t('history.date')}</th>
                <th>{t('history.type')}</th>
                <th>{t('history.details')}</th>
              </tr>
            </thead>
            <tbody>
              {rangeEvents.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.at)}</td>
                  <td>{t(`report.event.${e.type}`, { defaultValue: e.type })}</td>
                  <td>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      <Card title={t('trends.title')}>
        <TrendsSection
          sessions={rangeSessions}
          checks={rangeChecks}
          dailyCap={settings.caps.dailyCapMinutes}
          days={range === 0 ? Math.min(90, sum.daysInRange) : range}
        />
      </Card>

      <Card title={t('report.downloads')}>
        <div className="row no-print">
          <Button
            onClick={() =>
              downloadText(`sessions-${stamp}.csv`, sessionsToCsv(rangeSessions, checks), 'text/csv')
            }
          >
            {t('report.csvSessions')}
          </Button>
          <Button
            onClick={() => downloadText(`symptoms-${stamp}.csv`, symptomsToCsv(rangeChecks), 'text/csv')}
          >
            {t('report.csvSymptoms')}
          </Button>
          <Button
            onClick={() =>
              downloadText(`safety-events-${stamp}.csv`, safetyEventsToCsv(rangeEvents), 'text/csv')
            }
          >
            {t('report.csvSafety')}
          </Button>
          <Button
            onClick={() =>
              downloadText(
                `weekly-checks-${stamp}.csv`,
                assessmentsToCsv(all.data?.assessments ?? []),
                'text/csv',
              )
            }
          >
            {t('report.csvChecks')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
