import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useActiveCalibration, useAllData } from '../data/hooks';
import { DISCLAIMER_VERSION, moduleIdSchema, type IntensityTier, type ModuleId } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { getModule } from '../modules/registry';
import { evaluateGate } from '../safety/gating';
import { Banner, Card, Field, Segmented } from '../ui';

const VALID: readonly ModuleId[] = moduleIdSchema.options;

export function ModuleView() {
  const { t } = useTranslation();
  const { moduleId } = useParams();
  const id = (VALID.includes(moduleId as ModuleId) ? moduleId : 'l1') as ModuleId;
  const def = getModule(id);
  const settings = useSettings();
  const all = useAllData();
  const { calibration } = useActiveCalibration();
  const plan = settings.dailyPlan[id] ?? {
    minutes: def.defaultMinutes,
    intensityTier: 'low' as const,
    enabled: false,
  };
  const sessions = (all.data?.sessions ?? [])
    .filter((s) => s.moduleId === id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const checks = all.data?.checks ?? [];
  const gate = evaluateGate(id, {
    settings,
    sessions: all.data?.sessions ?? [],
    checks,
    disclaimerVersion: DISCLAIMER_VERSION,
  });
  const progress = settings.moduleProgress[id];
  const tiers: IntensityTier[] = ['low', 'medium', 'high'];
  const clinicianNeeded = def.intensity.requiresClinician && !settings.clinicianAgreement;

  return (
    <div>
      <div className="module-head">
        <span className="code-badge" aria-hidden="true">
          {def.code}
        </span>
        <h1>
          <span className="sr-only">{def.code} </span>
          {t(`modules.${id}.name`)}
        </h1>
      </div>
      <p>{t(`modules.${id}.description`)}</p>
      <Card title={t('module.intensityMap')}>
        <p className="hint">{t('module.intensityHint')}</p>
        <table>
          <thead>
            <tr>
              <th>{t('overview.intensity')}</th>
              <th>{t(`metrics.${def.intensity.metric}`)}</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier}>
                <td>{t(`intensity.${tier}`)}</td>
                <td>
                  {calibration ? def.intensity.format(def.intensity.valueForTier(tier, calibration)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          {t('module.stepRule', {
            step: def.intensity.format(def.intensity.maxStepPerSession),
            back: def.intensity.format(def.intensity.stepBack),
          })}
        </p>
        {def.intensity.requiresClinician ? (
          <Banner tone="warn">{t('module.clinicianRequired')}</Banner>
        ) : null}
        <p className="hint">{t(`modules.${id}.gameDifficulty`)}</p>
      </Card>

      <Card title={t('module.plan')}>
        <label className="row">
          <input
            type="checkbox"
            checked={plan.enabled}
            onChange={(e) => settings.setDailyPlanEntry(id, { enabled: e.target.checked })}
            disabled={!def.implemented}
          />
          <span>{t('module.enabled')}</span>
        </label>
        <Field
          label={t('module.plannedMinutes')}
          htmlFor="plan-minutes"
          hint={t('module.minutesHint', { min: def.minMinutes, max: def.maxMinutes })}
        >
          <input
            id="plan-minutes"
            type="number"
            min={def.minMinutes}
            max={def.maxMinutes}
            value={plan.minutes}
            onChange={(e) =>
              settings.setDailyPlanEntry(id, {
                minutes: Math.max(def.minMinutes, Math.min(def.maxMinutes, Number(e.target.value))),
              })
            }
          />
        </Field>
        <Field label={t('module.plannedIntensity')} hint={t('module.intensityStepHint')}>
          <Segmented
            value={plan.intensityTier}
            onChange={(tier) => settings.setDailyPlanEntry(id, { intensityTier: tier })}
            label={t('module.plannedIntensity')}
            options={tiers.map((tier) => ({ value: tier, label: t(`intensity.${tier}`) }))}
            disabledValues={clinicianNeeded ? ['medium', 'high'] : []}
          />
        </Field>
        {progress ? (
          <p>
            {t('module.currentProgress', {
              value: def.intensity.format(progress.intensityValue),
              tier: t(`intensity.${progress.intensityTier}`),
              game: progress.gameDifficulty,
            })}
          </p>
        ) : null}
        <div className="row">
          {def.implemented && gate.unlocked && plan.enabled ? (
            <Link className="btn primary" to={`/train/${id}`}>
              {t('overview.start')}
            </Link>
          ) : (
            <span className="hint">
              {def.implemented
                ? gate.reasons.map((r) => t(`gate.${r}`)).join(' ')
                : t('gate.not-implemented')}
            </span>
          )}
        </div>
      </Card>

      <Card title={t('module.history')}>
        {sessions.length === 0 ? <p className="hint">{t('module.noSessions')}</p> : null}
        {sessions.length ? (
          <table>
            <thead>
              <tr>
                <th>{t('history.date')}</th>
                <th>{t('history.minutes')}</th>
                <th>{t('overview.intensity')}</th>
                <th>{t('history.status')}</th>
                <th>{t('history.postDiplopia')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 30).map((s) => {
                const post = checks.find((c) => c.id === s.postCheckId);
                return (
                  <tr key={s.id}>
                    <td>{new Date(s.startedAt).toLocaleString()}</td>
                    <td>{s.actualMinutes.toFixed(1)}</td>
                    <td>
                      {t('module.sessionIntensity', {
                        tier: t(`intensity.${s.intensityTier}`),
                        value: def.intensity.format(s.intensityValue),
                        game: s.gameDifficulty,
                      })}
                    </td>
                    <td>{t(`status.${s.status}`)}</td>
                    <td>
                      {post
                        ? t(
                            `symptoms.frequency.${['never', 'rarely', 'sometimes', 'often', 'always'][post.diplopia]}`,
                          )
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
