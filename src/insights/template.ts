import type { TFunction } from 'i18next';
import type { WeeklyFacts } from './facts';
import type { Draft } from './guardrails';

/**
 * The rule-based recap: always available, always correct, and the baseline the AI version is
 * compared with. It passes the same guardrails as the model's drafts (see the unit tests).
 */
export function templateDraft(f: WeeklyFacts, t: TFunction): Draft {
  const c = f.oneEyeChecks;
  const points: string[] = [
    t('insights.tpl.days', { days: f.thisWeek.daysTrained, lastDays: f.lastWeek.daysTrained }),
  ];
  if (c.left.seenPercent !== null && c.right.seenPercent !== null)
    points.push(t('insights.tpl.eyesBoth', { left: c.left.seenPercent, right: c.right.seenPercent }));
  else if (c.left.seenPercent !== null) points.push(t('insights.tpl.eyeLeft', { left: c.left.seenPercent }));
  else if (c.right.seenPercent !== null)
    points.push(t('insights.tpl.eyeRight', { right: c.right.seenPercent }));
  else points.push(t('insights.tpl.noChecks'));

  const top = f.thisWeek.modules[0];
  if (c.doubtfulSessions > 0) points.push(t('insights.tpl.doubtful', { count: c.doubtfulSessions }));
  else if (top)
    points.push(
      t('insights.tpl.topModule', { name: t(`modules.${top.moduleId}.name`), minutes: top.minutes }),
    );

  const suggestion =
    c.doubtfulSessions > 0
      ? t('insights.tpl.tipGlasses')
      : f.thisWeek.daysTrained <= 2
        ? t('insights.tpl.tipSpread')
        : t('insights.tpl.tipKeep');

  return {
    headline: t('insights.tpl.headline', { sessions: f.thisWeek.sessions, minutes: f.thisWeek.minutes }),
    points,
    suggestion,
  };
}
