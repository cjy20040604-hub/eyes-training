import { useTranslation } from 'react-i18next';
import type { ClinicalPrism } from '../data/schema';
import { sanitizeText } from '../data/sanitize';
import {
  isPlausiblePrismDiopters,
  prismDioptersToDegrees,
  prismDioptersToPx,
  prismDioptersToScreenCm,
  round,
  type ScreenGeometry,
} from '../engine/units';
import { Banner, Field, Segmented } from '../ui';

export function defaultClinicalPrism(): ClinicalPrism {
  return {
    amountDelta: 7,
    base: 'in',
    range: 'distance',
    measuredOn: new Date().toISOString().slice(0, 10),
    fusionWithPrism: 'unknown',
    notes: '',
  };
}

/** Clinical prism measurement form; seeds the initial virtual-prism offset. */
export function PrismInputForm({
  value,
  onChange,
  geometry,
}: {
  value: ClinicalPrism;
  onChange: (v: ClinicalPrism) => void;
  geometry: ScreenGeometry | null;
}) {
  const { t } = useTranslation();
  const plausible = isPlausiblePrismDiopters(value.amountDelta);
  const cm = prismDioptersToScreenCm(value.amountDelta, geometry?.distanceM ?? 0);
  const px = geometry ? prismDioptersToPx(value.amountDelta, geometry) : 0;
  return (
    <div className="stack">
      <p>{t('calibration.prism.intro')}</p>
      <Field
        label={t('calibration.prism.amount')}
        htmlFor="prism-amount"
        hint={t('calibration.prism.amountHint')}
      >
        <input
          id="prism-amount"
          type="number"
          min={0}
          max={40}
          step={0.5}
          value={value.amountDelta}
          onChange={(e) => onChange({ ...value, amountDelta: Number(e.target.value) })}
          data-testid="prism-amount"
        />
      </Field>
      {!plausible ? <Banner tone="danger">{t('calibration.prism.implausible')}</Banner> : null}
      <Field label={t('calibration.prism.base')}>
        <Segmented
          value={value.base}
          onChange={(base) => onChange({ ...value, base })}
          label={t('calibration.prism.base')}
          options={(['in', 'out', 'up', 'down'] as const).map((b) => ({
            value: b,
            label: t(`calibration.prism.bases.${b}`),
          }))}
        />
      </Field>
      <Field label={t('calibration.prism.range')}>
        <Segmented
          value={value.range}
          onChange={(range) => onChange({ ...value, range })}
          label={t('calibration.prism.range')}
          options={[
            { value: 'near', label: t('calibration.prism.near') },
            { value: 'distance', label: t('calibration.prism.distance') },
          ]}
        />
      </Field>
      <Field label={t('calibration.prism.date')} htmlFor="prism-date">
        <input
          id="prism-date"
          type="date"
          value={value.measuredOn}
          onChange={(e) => onChange({ ...value, measuredOn: e.target.value })}
        />
      </Field>
      <Field label={t('calibration.prism.fusion')} hint={t('calibration.prism.fusionHint')}>
        <Segmented
          value={value.fusionWithPrism}
          onChange={(fusionWithPrism) => onChange({ ...value, fusionWithPrism })}
          label={t('calibration.prism.fusion')}
          options={[
            { value: 'fused', label: t('calibration.prism.fused') },
            { value: 'double', label: t('calibration.prism.double') },
            { value: 'unknown', label: t('calibration.prism.unknown') },
          ]}
        />
      </Field>
      <Field label={t('calibration.prism.notes')} htmlFor="prism-notes">
        <textarea
          id="prism-notes"
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: sanitizeText(e.target.value) })}
          maxLength={2000}
        />
      </Field>
      <Banner tone="info" title={t('calibration.prism.conversionTitle')}>
        {t('calibration.prism.conversion', {
          delta: value.amountDelta,
          deg: round(prismDioptersToDegrees(value.amountDelta), 2),
          distance: geometry ? round(geometry.distanceM * 100, 0) : '?',
          cm: round(cm, 2),
          px: round(px, 1),
        })}
      </Banner>
    </div>
  );
}
