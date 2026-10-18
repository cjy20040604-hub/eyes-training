import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { weeklyFacts, type InsightData, type WeeklyFacts } from './facts';

/** Builds the facts for the last 7 days, with English module names for the model. */
export function useWeeklyFacts(data: InsightData | null): WeeklyFacts | null {
  const { i18n } = useTranslation();
  return useMemo(() => {
    if (!data) return null;
    const en = i18n.getFixedT('en');
    return weeklyFacts(data, new Date(), (id) => en(`modules.${id}.name`));
  }, [data, i18n]);
}
