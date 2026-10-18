import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useActiveCalibration, useAllData } from '../data/hooks';
import { DISCLAIMER_VERSION, type SessionRecord } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { trainedToday, updateAppBadge } from '../data/goals';
import { dayKey, dayKeyOffset } from '../data/util';
import { MODULES } from '../modules/registry';
import type { ModuleDefinition } from '../modules/types';
import { isDailyCapReached, minutesUsedOnDay } from '../safety/caps';
import { evaluateGate, type GateResult } from '../safety/gating';
import { Banner, Progress } from '../ui';
import { RecapTeaser } from '../insights/RecapTeaser';
import { BackupReminder, WeeklyCheckCard, WeeklyGoal } from './OverviewCards';

const wholeMinutes = (m: number) => Math.round(m);

function localeTag(lng: string): string {
  return lng === 'zh-Hans' ? 'zh-CN' : 'en-GB';
}

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * The prism bar: one graduated step per minute up to the daily limit, rising left to right
 * like an orthoptist's prism bar. Filled = trained today, outlined = still planned.
 */
function PrismBar({ done, planned, cap }: { done: number; planned: number; cap: number }) {
  const { t } = useTranslation();
  const steps = Math.max(1, Math.round(cap));
  const doneSteps = Math.min(steps, wholeMinutes(done));
  const plannedSteps = Math.min(steps, Math.max(doneSteps, wholeMinutes(planned)));
  return (
    <div className="meter">
      <div
        className={`prism-bar ${doneSteps >= steps ? 'capped' : ''}`}
        role="img"
        aria-label={t('overview.meterLabel', { done: doneSteps, planned: plannedSteps, cap: steps })}
      >
        {Array.from({ length: steps }, (_, i) => {
          const n = i + 1;
          const kind = n <= doneSteps ? 'done' : n <= plannedSteps ? 'planned' : 'spare';
          return <span key={n} className={`step ${kind}`} style={{ height: `${30 + (70 * n) / steps}%` }} />;
        })}
      </div>
      <div className="prism-scale" aria-hidden="true">
        <span>{t('overview.limit', { cap: steps })}</span>
      </div>
      <div className="legend" aria-hidden="true">
        <span>
          <i className="done" />
          {t('overview.legendDone')}
        </span>
        <span>
          <i className="planned" />
          {t('overview.legendPlanned')}
        </span>
        <span>
          <i className="spare" />
          {t('overview.legendSpare')}
        </span>
      </div>
    </div>
  );
}

interface RowModel {
  def: ModuleDefinition;
  gate: GateResult;
  plannedMinutes: number;
  enabled: boolean;
  doneMinutes: number;
  isDone: boolean;
  startable: boolean;
}

export function Overview() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const all = useAllData();
  const { calibration } = useActiveCalibration();
  const today = dayKey();
  const sessions: SessionRecord[] = all.data?.sessions ?? [];
  const checks = all.data?.checks ?? [];
  const cap = settings.caps.dailyCapMinutes;
  const used = minutesUsedOnDay(sessions, today);
  const capReached = isDailyCapReached(settings.caps, used);
  const locale = localeTag(i18n.language);
  // Installed app: a dot on the icon on days without training yet.
  useEffect(() => {
    if (all.data) void updateAppBadge(trainedToday(all.data.sessions));
  }, [all.data]);

  const rows: RowModel[] = MODULES.map((def) => {
    const plan = settings.dailyPlan[def.id] ?? { minutes: 0, intensityTier: 'low' as const, enabled: false };
    const doneMinutes = sessions
      .filter((s) => s.moduleId === def.id && s.day === today)
      .reduce((a, s) => a + s.actualMinutes, 0);
    const gate = evaluateGate(def.id, {
      settings,
      sessions,
      checks,
      disclaimerVersion: DISCLAIMER_VERSION,
      calibrationQuality: calibration?.quality,
    });
    const enabled = plan.enabled && def.implemented;
    const plannedMinutes = enabled ? plan.minutes : 0;
    return {
      def,
      gate,
      plannedMinutes,
      enabled,
      doneMinutes,
      isDone: enabled && plannedMinutes > 0 && doneMinutes >= plannedMinutes - 0.05,
      startable: def.implemented && gate.unlocked && !capReached && enabled,
    };
  });
  // A stage is locked until its unlock conditions are met (comfortable sessions, clinician).
  const STAGE_REASONS = [
    'needs-stable-sessions',
    'needs-distinct-days',
    'recent-stop',
    'clinician-agreement',
    'needs-full-calibration',
  ];
  const stageLocked = (r: RowModel) =>
    !r.def.implemented || r.gate.reasons.some((x) => STAGE_REASONS.includes(x));
  const current = rows.filter((r) => r.enabled && !stageLocked(r));
  const available = rows.filter((r) => !r.enabled && !stageLocked(r));
  const later = rows.filter(stageLocked);
  const plannedTotal = current.reduce((a, r) => a + r.plannedMinutes, 0);
  const next = current.find((r) => r.startable && !r.isDone) ?? null;
  const planDone = current.some((r) => r.enabled) && current.every((r) => !r.enabled || r.isDone);

  const longDate = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );

  const days = Array.from({ length: 7 }, (_, i) => dayKeyOffset(i - 6));
  const flagged = new Set<string>();
  for (const ev of all.data?.safetyEvents ?? []) {
    if (ev.type === 'red-flag' || ev.type === 'stop' || ev.type === 'flash-pause')
      flagged.add(ev.at.slice(0, 10));
  }
  const dayMinutes = days.map((d) =>
    sessions.filter((s) => s.day === d).reduce((a, s) => a + s.actualMinutes, 0),
  );
  const scaleMax = Math.max(cap, ...dayMinutes);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  return (
    <div>
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
      <BackupReminder sessions={sessions} />
      {calibration?.quality === 'quick' ? (
        <div data-testid="quick-banner">
          <Banner tone="info" title={t('quick.bannerTitle')}>
            {t('quick.bannerBody')} <Link to="/calibration">{t('quick.bannerLink')}</Link>
          </Banner>
        </div>
      ) : null}
      <section className="today" aria-labelledby="today-title">
        <div>
          <p className="date">{longDate}</p>
          <h1 id="today-title">{t('overview.todayTitle')}</h1>
          <p className="summary" data-testid="today-summary">
            {t('overview.summary', { done: wholeMinutes(used), planned: plannedTotal })}
          </p>
        </div>
        <div className="next">
          {!calibration && !all.loading ? (
            <>
              <Link className="btn primary" to="/quick-start" data-testid="start-quick">
                {t('quick.start')}
              </Link>
              <span className="hint">{t('quick.startHint')}</span>
              <Link className="btn" to="/calibration" data-testid="start-calibration">
                {t('overview.setUpCalibration')}
              </Link>
              <span className="hint">{t('overview.setUpHint')}</span>
            </>
          ) : capReached ? (
            <Banner tone="danger" title={t('overview.capReached')} role="status">
              {t('overview.capReachedBody')}
            </Banner>
          ) : next ? (
            <>
              <Link className="btn primary" to={`/train/${next.def.id}`} data-testid="start-next">
                {t('overview.startNext', { code: next.def.code, name: t(`modules.${next.def.id}.name`) })}
              </Link>
              <span className="hint">{t('overview.nextHint', { minutes: next.plannedMinutes })}</span>
            </>
          ) : planDone ? (
            <p className="done-mark">{t('overview.allDone')}</p>
          ) : null}
        </div>
        <PrismBar done={used} planned={plannedTotal} cap={cap} />
      </section>

      <div className="goal-row">
        <WeeklyGoal sessions={sessions} />
        <WeeklyCheckCard
          assessments={all.data?.assessments ?? []}
          enabled={!!calibration && !settings.trainingLock.locked}
        />
        {sessions.length ? <RecapTeaser data={all.data ?? null} /> : null}
      </div>

      <h2 className="section-title">{t('overview.planTitle')}</h2>
      <ul className="plan-list">
        {current.map((r) => {
          const progress = settings.moduleProgress[r.def.id];
          const plan = settings.dailyPlan[r.def.id];
          const tier = progress?.intensityTier ?? plan?.intensityTier ?? 'low';
          const value =
            progress?.intensityValue ??
            (calibration ? r.def.intensity.valueForTier(tier, calibration) : null);
          const blockReasons = r.gate.reasons.filter((x) => x !== 'disclaimer');
          return (
            <li
              key={r.def.id}
              className={`module-row ${r.isDone ? 'done' : ''}`}
              data-testid={`module-row-${r.def.id}`}
            >
              <span className="code-badge" aria-hidden="true">
                {r.def.code}
              </span>
              <div>
                <h3>
                  <span className="sr-only">{r.def.code} </span>
                  {t(`modules.${r.def.id}.name`)}
                </h3>
                <p className="what">{t(`modules.${r.def.id}.tagline`)}</p>
                <p className="facts" data-testid={`game-level-${r.def.id}`}>
                  {t('overview.facts', {
                    tier: t(`intensity.${tier}`),
                    metric: t(`metrics.${r.def.intensity.metric}`),
                    value: value === null ? '—' : r.def.intensity.format(value),
                    game: progress?.gameDifficulty ?? 1,
                  })}
                </p>
                {blockReasons.length ? (
                  <p className="facts">{blockReasons.map((x) => t(`gate.${x}`)).join(' ')}</p>
                ) : null}
              </div>
              <div className="side">
                {r.enabled ? (
                  <span className="minutes">
                    {wholeMinutes(r.doneMinutes)}{' '}
                    <small>/ {t('overview.minutes', { n: r.plannedMinutes })}</small>
                  </span>
                ) : (
                  <span className="hint">{t('overview.notInPlan')}</span>
                )}
                {r.isDone ? <span className="done-mark">{t('overview.doneToday')}</span> : null}
                <div className="row">
                  {r.startable ? (
                    <Link
                      className={`btn ${r === next ? 'primary' : ''}`}
                      to={`/train/${r.def.id}`}
                      data-testid={`start-${r.def.id}`}
                    >
                      {r.isDone ? t('overview.trainAgain') : t('overview.start')}
                    </Link>
                  ) : null}
                  <Link className="btn ghost" to={`/module/${r.def.id}`}>
                    {t('overview.details')}
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {current.length === 0 ? <p className="hint">{t('overview.planEmpty')}</p> : null}

      {available.length ? (
        <section aria-labelledby="available-title">
          <h2 className="section-title" id="available-title">
            {t('overview.availableTitle')}
          </h2>
          <ul className="later-list">
            {available.map((r) => (
              <li key={r.def.id} data-testid={`available-${r.def.id}`}>
                <span className="code-badge" aria-hidden="true">
                  {r.def.code}
                </span>
                <div className="available-row">
                  <div>
                    <strong>
                      <span className="sr-only">{r.def.code} </span>
                      {t(`modules.${r.def.id}.name`)}
                    </strong>
                    <span className="why">{t(`modules.${r.def.id}.tagline`)}</span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      data-testid={`add-${r.def.id}`}
                      onClick={() =>
                        settings.setDailyPlanEntry(r.def.id, {
                          enabled: true,
                          minutes: settings.dailyPlan[r.def.id]?.minutes || r.def.defaultMinutes,
                        })
                      }
                    >
                      {t('overview.addToPlan')}
                    </button>
                    <Link className="btn ghost" to={`/module/${r.def.id}`}>
                      {t('overview.details')}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="lower">
        <section aria-labelledby="week-title">
          <h2 className="section-title" id="week-title">
            {t('overview.week')}
          </h2>
          <div className="week-chart" role="list">
            {days.map((d, i) => {
              const mins = dayMinutes[i] ?? 0;
              const label = weekday.format(dateFromKey(d));
              const isToday = d === today;
              return (
                <div
                  key={d}
                  role="listitem"
                  className={`col ${mins === 0 ? 'zero' : ''} ${isToday ? 'is-today' : ''}`}
                  aria-label={t('overview.dayLabel', { day: label, minutes: wholeMinutes(mins) })}
                >
                  {flagged.has(d) ? (
                    <span className="flag" title={t('overview.flagDay')}>
                      !
                    </span>
                  ) : null}
                  <span className="mins">{wholeMinutes(mins)}</span>
                  <div className="bar" style={{ height: `${(mins / scaleMax) * 100}%` }} />
                  <span className="label">{label}</span>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {t('overview.restDays')}
          </p>
        </section>

        <section aria-labelledby="later-title">
          <h2 className="section-title" id="later-title">
            {t('overview.laterTitle')}
          </h2>
          {later.length === 0 ? <p className="hint">{t('overview.allUnlocked')}</p> : null}
          <ul className="later-list">
            {later.map((r) => {
              const needsSessions =
                r.gate.reasons.includes('needs-stable-sessions') ||
                r.gate.reasons.includes('needs-distinct-days');
              const fraction =
                (Math.min(r.gate.stableSessions, r.gate.needed) +
                  Math.min(r.gate.distinctDays, r.gate.neededDays)) /
                (r.gate.needed + r.gate.neededDays);
              return (
                <li key={r.def.id} data-testid={`later-${r.def.id}`}>
                  <span className="code-badge" aria-hidden="true">
                    {r.def.code}
                  </span>
                  <div>
                    <strong>
                      <span className="sr-only">{r.def.code} </span>
                      {t(`modules.${r.def.id}.name`)}
                    </strong>
                    <span className="why">
                      {[
                        r.gate.reasons.includes('recent-stop') ? t('gate.recent-stop') : '',
                        r.gate.reasons.includes('clinician-agreement') ? t('gate.clinician-agreement') : '',
                        r.gate.reasons.includes('needs-full-calibration')
                          ? t('gate.needs-full-calibration')
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || t('overview.unlocksWith')}
                    </span>
                    {needsSessions ? (
                      <div className="unlock">
                        <Progress
                          value={fraction}
                          label={t('overview.unlockLabel', { name: t(`modules.${r.def.id}.name`) })}
                        />
                        <span>
                          {t('overview.unlockProgress', {
                            sessions: r.gate.stableSessions,
                            needed: r.gate.needed,
                            days: r.gate.distinctDays,
                            neededDays: r.gate.neededDays,
                          })}
                        </span>
                      </div>
                    ) : (
                      <div className="unlock">
                        <span className="done-mark">{t('overview.unlockReady')}</span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
