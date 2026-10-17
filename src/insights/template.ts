import type { TFunction } from 'i18next';
import type { WeeklyFacts } from './facts';
import type { Draft } from './guardrails';

/**
 * The rule-based recap: always available, always correct, and the baseline the AI version is
 * compared with. It passes the same guardrails as the model's drafts (see the unit tests).
 */
/**
 * Sentences every recap must contain, written by rules rather than the model (v4): the
 * model had been asked to mention mismatched reports and learned to pass the check with
 * the right keywords but the wrong meaning.
 */
export function mustSayLines(f: WeeklyFacts, t: TFunction): string[] {
  const n = f.oneEyeChecks.doubtfulSessions;
  return n > 0 ? [t('insights.tpl.doubtful', { count: n })] : [];
}

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
  const mustSay = mustSayLines(f, t);
  if (mustSay.length) points.push(...mustSay);
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
