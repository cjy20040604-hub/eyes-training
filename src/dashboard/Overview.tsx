import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useActiveCalibration, useAllData } from '../data/hooks';
import { DISCLAIMER_VERSION, type ModuleId } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { dayKey, dayKeyOffset } from '../data/util';
import { MODULES } from '../modules/registry';
import { isDailyCapReached, minutesUsedOnDay, remainingDailyMinutes } from '../safety/caps';
import { evaluateGate } from '../safety/gating';
import { Banner, Card, Progress, Stat } from '../ui';

export function Overview() {
  const { t } = useTranslation();
  const settings = useSettings();
  const all = useAllData();
  const { calibration } = useActiveCalibration();
  const today = dayKey();
  const sessions = all.data?.sessions ?? [];
  const checks = all.data?.checks ?? [];
  const used = minutesUsedOnDay(sessions, today);
  const remaining = remainingDailyMinutes(settings.caps, used);
  const capReached = isDailyCapReached(settings.caps, used);
  const plannedTotal = Object.values(settings.dailyPlan).reduce((a, p) => a + (p.enabled ? p.minutes : 0), 0);

  const days = Array.from({ length: 7 }, (_, i) => dayKeyOffset(i - 6));
  const flagsByDay = new Map<string, boolean>();
  for (const ev of all.data?.safetyEvents ?? []) {
    if (ev.type === 'red-flag' || ev.type === 'stop' || ev.type === 'flash-pause')
      flagsByDay.set(ev.at.slice(0, 10), true);
  }

  return (
    <div>
      <h1>{t('overview.title')}</h1>
      {settings.trainingLock.locked ? (
        <Banner tone="danger" title={t('overview.trainingLocked')}>
          <Link to="/red-flag">{t('overview.openRedFlag')}</Link>
        </Banner>
      ) : null}
      {settings.progressionLock.locked ? (
        <Banner tone="warn" title={t('overview.progressionLocked')}>
          {t('training.progressionLockBody')}
        </Banner>
      ) : null}
      {!calibration ? (
        <Banner tone="info" title={t('overview.noCalibration')}>
          <Link to="/calibration">{t('nav.calibration')}</Link>
        </Banner>
      ) : null}

      <Card title={t('overview.today')}>
        <div className="row" style={{ gap: 32 }}>
          <Stat label={t('overview.plannedMinutes')} value={plannedTotal} />
          <Stat label={t('overview.actualMinutes')} value={used.toFixed(1)} />
          <Stat label={t('overview.remaining')} value={remaining.toFixed(1)} />
          <Stat label={t('overview.dailyCap')} value={settings.caps.dailyCapMinutes} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Progress
            value={used}
            max={settings.caps.dailyCapMinutes}
            tone={capReached ? 'danger' : used / settings.caps.dailyCapMinutes > 0.8 ? 'warn' : undefined}
          />
        </div>
        {capReached ? (
          <Banner tone="danger" title={t('overview.capReached')} role="status">
            {t('overview.capReachedBody')}
          </Banner>
        ) : null}
      </Card>

      <div className="grid">
        {MODULES.map((m) => {
          const plan = settings.dailyPlan[m.id] ?? {
            minutes: 0,
            intensityTier: 'low' as const,
            enabled: false,
          };
          const actual = sessions
            .filter((s) => s.moduleId === m.id && s.day === today)
            .reduce((a, s) => a + s.actualMinutes, 0);
          const gate = evaluateGate(m.id, {
            settings,
            sessions,
            checks,
            disclaimerVersion: DISCLAIMER_VERSION,
          });
          const progress = settings.moduleProgress[m.id];
          const intensityValue =
            progress?.intensityValue ??
            (calibration ? m.intensity.valueForTier(plan.intensityTier, calibration) : null);
          const startable = m.implemented && gate.unlocked && !capReached && plan.enabled;
          return (
            <Card key={m.id} title={`${m.code} · ${t(`modules.${m.id}.name`)}`} muted={!m.implemented}>
              <p className="hint">{t(`modules.${m.id}.tagline`)}</p>
              <table>
                <tbody>
                  <tr>
                    <th>{t('overview.duration')}</th>
                    <td>
                      {actual.toFixed(1)} / {plan.enabled ? plan.minutes : 0} min
                    </td>
                  </tr>
                  <tr>
                    <th>{t('overview.intensity')}</th>
                    <td>
                      {t(`intensity.${progress?.intensityTier ?? plan.intensityTier}`)}
                      {intensityValue !== null
                        ? ` · ${t(`metrics.${m.intensity.metric}`)} ${m.intensity.format(intensityValue)}`
                        : ''}
                    </td>
                  </tr>
                  <tr>
                    <th>{t('overview.gameDifficulty')}</th>
                    <td>{progress?.gameDifficulty ?? 1} / 5</td>
                  </tr>
                </tbody>
              </table>
              {!m.implemented ? <p className="hint">{t('gate.not-implemented')}</p> : null}
              {!gate.unlocked ? (
                <p className="hint">
                  {gate.reasons.map((r) => t(`gate.${r}`)).join(' · ')}
                  {gate.reasons.includes('needs-stable-sessions') ||
                  gate.reasons.includes('needs-distinct-days')
                    ? ` (${gate.stableSessions}/${gate.needed}, ${gate.distinctDays}/${gate.neededDays} ${t('overview.days')})`
                    : ''}
                </p>
              ) : null}
              <div className="row">
                <Link className="btn" to={`/module/${m.id}`}>
                  {t('overview.details')}
                </Link>
                {startable ? (
                  <Link className="btn primary" to={`/train/${m.id}`} data-testid={`start-${m.id}`}>
                    {t('overview.start')}
                  </Link>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title={t('overview.week')}>
        <div className="week">
          {days.map((d) => {
            const mins = sessions.filter((s) => s.day === d).reduce((a, s) => a + s.actualMinutes, 0);
            return (
              <div key={d} className={`day ${flagsByDay.get(d) ? 'flag' : ''}`}>
                <div>{d.slice(5)}</div>
                <div>{mins.toFixed(0)} min</div>
                <div
                  className="bar"
                  style={{ width: `${Math.min(100, (mins / settings.caps.dailyCapMinutes) * 100)}%` }}
                />
                {flagsByDay.get(d) ? <div aria-label={t('overview.flagDay')}>⚑</div> : null}
              </div>
            );
          })}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {t('overview.restDays')}
        </p>
      </Card>
      <ModuleGateHint ids={MODULES.filter((m) => !m.implemented).map((m) => m.id)} />
    </div>
  );
}

function ModuleGateHint({ ids }: { ids: ModuleId[] }) {
  const { t } = useTranslation();
  if (!ids.length) return null;
  return <p className="hint">{t('overview.phase2Hint')}</p>;
}
