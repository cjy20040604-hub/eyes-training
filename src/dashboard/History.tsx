import { useTranslation } from 'react-i18next';
import { downloadText, sessionsToCsv } from '../data/exportImport';
import { useAllData } from '../data/hooks';
import { FREQUENCY_LABELS } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { getModule } from '../modules/registry';
import { TrendsSection } from './TrendsSection';
import { Button, Card } from '../ui';

export function History() {
  const { t } = useTranslation();
  const all = useAllData();
  const dailyCap = useSettings((st) => st.caps.dailyCapMinutes);
  const sessions = [...(all.data?.sessions ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const checks = all.data?.checks ?? [];
  const events = [...(all.data?.safetyEvents ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const byId = new Map(checks.map((c) => [c.id, c]));

  return (
    <div>
      <h1>{t('history.title')}</h1>
      <Card title={t('trends.title')}>
        <TrendsSection sessions={all.data?.sessions ?? []} checks={checks} dailyCap={dailyCap} />
      </Card>
      <Card title={t('history.sessions')}>
        <div className="row no-print" style={{ marginBottom: 12 }}>
          <Button
            onClick={() =>
              downloadText(
                `eyes-training-sessions-${new Date().toISOString().slice(0, 10)}.csv`,
                sessionsToCsv(sessions, checks),
                'text/csv',
              )
            }
          >
            {t('history.exportCsv')}
          </Button>
          <Button onClick={() => window.print()}>{t('history.print')}</Button>
        </div>
        {sessions.length === 0 ? <p className="hint">{t('module.noSessions')}</p> : null}
        {sessions.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('history.date')}</th>
                <th>{t('history.module')}</th>
                <th>{t('history.minutes')}</th>
                <th>{t('overview.intensity')}</th>
                <th>{t('history.status')}</th>
                <th>{t('history.preDiplopia')}</th>
                <th>{t('history.postDiplopia')}</th>
                <th>{t('history.events')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const def = getModule(s.moduleId);
                const pre = s.preCheckId ? byId.get(s.preCheckId) : undefined;
                const post = s.postCheckId ? byId.get(s.postCheckId) : undefined;
                const flagged = s.events.filter(
                  (e) => e.type === 'stop' || e.type === 'flash-pause' || e.type === 'cap-hit',
                );
                return (
                  <tr key={s.id}>
                    <td>{new Date(s.startedAt).toLocaleString()}</td>
                    <td>{def.code}</td>
                    <td>{s.actualMinutes.toFixed(1)}</td>
                    <td>
                      {t(`intensity.${s.intensityTier}`)}, {def.intensity.format(s.intensityValue)}
                    </td>
                    <td>{t(`status.${s.status}`)}</td>
                    <td>{pre ? t(`symptoms.frequency.${FREQUENCY_LABELS[pre.diplopia]}`) : '—'}</td>
                    <td>{post ? t(`symptoms.frequency.${FREQUENCY_LABELS[post.diplopia]}`) : '—'}</td>
                    <td>{flagged.map((e) => e.type).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card title={t('history.safetyEvents')}>
        {events.length === 0 ? <p className="hint">{t('history.noEvents')}</p> : null}
        {events.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('history.date')}</th>
                <th>{t('history.type')}</th>
                <th>{t('history.details')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString()}</td>
                  <td>{e.type}</td>
                  <td>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
