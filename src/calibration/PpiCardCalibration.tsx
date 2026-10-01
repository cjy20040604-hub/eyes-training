import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ID1_CARD_HEIGHT_MM,
  ID1_CARD_WIDTH_MM,
  isPlausiblePpi,
  ppiFromCardWidthPx,
  round,
} from '../engine/units';
import { Banner, Button, Field } from '../ui';

/**
 * Credit-card PPI calibration. The user resizes the rectangle until it matches a real
 * ISO/IEC 7810 ID-1 card held against the screen. PPI = matched px / (85.6 mm / 25.4).
 * Implausible values (outside 50–400) are refused.
 */
export function PpiCardCalibration({
  initialWidthPx,
  onChange,
}: {
  initialWidthPx: number | null;
  onChange: (result: { widthPx: number; ppi: number } | null) => void;
}) {
  const { t } = useTranslation();
  const [widthPx, setWidthPx] = useState(initialWidthPx ?? 324);
  const ppi = ppiFromCardWidthPx(widthPx);
  const plausible = isPlausiblePpi(ppi);
  const heightPx = widthPx * (ID1_CARD_HEIGHT_MM / ID1_CARD_WIDTH_MM);
  const zoomed =
    typeof window !== 'undefined' && window.visualViewport
      ? Math.abs(window.visualViewport.scale - 1) > 0.01
      : false;

  useEffect(() => {
    onChange(plausible ? { widthPx, ppi: round(ppi, 2) } : null);
  }, [widthPx, ppi, plausible, onChange]);

  return (
    <div className="stack">
      <p>{t('calibration.ppi.intro')}</p>
      <Banner tone="info">{t('calibration.ppi.zoomHint')}</Banner>
      {zoomed ? <Banner tone="warn">{t('calibration.ppi.zoomDetected')}</Banner> : null}
      <div className="card-calib">
        <div className="card-rect" style={{ width: widthPx, height: heightPx }} aria-hidden="true" />
      </div>
      <Field
        label={t('calibration.ppi.sliderLabel')}
        htmlFor="ppi-slider"
        hint={t('calibration.ppi.sliderHint')}
      >
        <input
          id="ppi-slider"
          type="range"
          min={150}
          max={900}
          step={1}
          value={widthPx}
          onChange={(e) => setWidthPx(Number(e.target.value))}
        />
      </Field>
      <div className="row">
        <Button small onClick={() => setWidthPx((w) => w - 1)} aria-label={t('calibration.ppi.narrower')}>
          −1 px
        </Button>
        <Button small onClick={() => setWidthPx((w) => w + 1)} aria-label={t('calibration.ppi.wider')}>
          +1 px
        </Button>
        <span data-testid="ppi-value">
          {t('calibration.ppi.result', { px: widthPx, ppi: round(ppi, 1) })}
        </span>
      </div>
      {!plausible ? <Banner tone="danger">{t('calibration.ppi.implausible')}</Banner> : null}
    </div>
  );
}
