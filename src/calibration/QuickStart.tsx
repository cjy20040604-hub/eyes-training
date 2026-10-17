import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../data/db';
import type { CalibrationProfile, ClinicalPrism } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { dayKey, newId, nowIso } from '../data/util';
import { IDENTITY_TRANSFORM } from '../engine/affine';
import { DEFAULT_CHANNEL_MAP, type EyeChannelMap, type RenderOptions } from '../engine/renderer';
import {
  isPlausibleDistanceCm,
  isPlausiblePrismDiopters,
  prismToPixelOffset,
  round,
  type ScreenGeometry,
} from '../engine/units';
import { Banner, Button, Card, Field, Segmented } from '../ui';
import { CalibCanvas } from './CalibCanvas';
import { glassesStimulus } from './stimuli';

/**
 * Quick start: about 3 minutes to a first session.
 *  1. Device type (screen size estimated from the resolution, or the diagonal if known) and
 *     viewing distance.
 *  2. Which square each eye sees through the glasses.
 *  3. Optionally, a known prism value to start the offset from.
 * The profile is marked 'quick'. It is enough for L1–L3; the full calibration (card-measured
 * screen, Worth 4-dot, offset fine-tuning, contrast balance) is offered on the overview and
 * is required for modules that depend on exact Δ / arcsec conversion.
 */

export type DeviceKind = 'laptop' | 'desktop' | 'tablet' | 'phone';
export const DEVICE_PRESETS: Record<DeviceKind, { diagonalIn: number; distanceCm: number }> = {
  laptop: { diagonalIn: 14, distanceCm: 55 },
  desktop: { diagonalIn: 24, distanceCm: 65 },
  tablet: { diagonalIn: 11, distanceCm: 40 },
  phone: { diagonalIn: 6.1, distanceCm: 35 },
};

/** CSS px per inch from the screen size in CSS px and its diagonal in inches (clamped to 50–400). */
export function estimatePpi(screenWidthPx: number, screenHeightPx: number, diagonalIn: number): number {
  const ppi = Math.hypot(screenWidthPx, screenHeightPx) / Math.max(1, diagonalIn);
  return Math.round(Math.min(400, Math.max(50, ppi)) * 10) / 10;
}

export function QuickStart() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveCalibration = useSettings((s) => s.setActiveCalibration);
  const [kind, setKind] = useState<DeviceKind>('laptop');
  const [diagonal, setDiagonal] = useState('');
  const [distanceCm, setDistanceCm] = useState(DEVICE_PRESETS.laptop.distanceCm);
  const [eyeChoice, setEyeChoice] = useState<'A' | 'B' | null>(null);
  const [channels, setChannels] = useState<EyeChannelMap>(DEFAULT_CHANNEL_MAP);
  const [knowsPrism, setKnowsPrism] = useState(false);
  const [prismAmount, setPrismAmount] = useState(7);
  const [prismBase, setPrismBase] = useState<ClinicalPrism['base']>('in');
  const [saving, setSaving] = useState(false);

  const sw = typeof screen !== 'undefined' ? screen.width : 1280;
  const sh = typeof screen !== 'undefined' ? screen.height : 800;
  const diagonalIn = Number(diagonal) > 2 ? Number(diagonal) : DEVICE_PRESETS[kind].diagonalIn;
  const ppi = estimatePpi(sw, sh, diagonalIn);
  const geometry: ScreenGeometry = { distanceM: distanceCm / 100, ppi };
  const prismOk = !knowsPrism || isPlausiblePrismDiopters(prismAmount);
  const ready = eyeChoice !== null && isPlausibleDistanceCm(distanceCm) && prismOk;

  const identity = useMemo<RenderOptions>(
    () => ({
      transforms: { left: { ...IDENTITY_TRANSFORM }, right: { ...IDENTITY_TRANSFORM } },
      channels: DEFAULT_CHANNEL_MAP,
      contrast: { left: 1, right: 1 },
      backgroundGray: 0,
    }),
    [],
  );
  const drawGlasses = useMemo(() => glassesStimulus(DEFAULT_CHANNEL_MAP), []);

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const now = nowIso();
    const offset = knowsPrism
      ? prismToPixelOffset({ amountDelta: prismAmount, base: prismBase, eye: 'left' }, geometry)
      : { dx: 0, dy: 0 };
    const profile: CalibrationProfile = {
      id: newId('cal'),
      name: t('quick.profileName', { date: dayKey() }),
      createdAt: now,
      updatedAt: now,
      quality: 'quick',
      device: {
        ppi,
        cardWidthPx: round((ppi * 85.6) / 25.4, 1),
        dpr: window.devicePixelRatio || 1,
        screenWidth: sw,
        screenHeight: sh,
      },
      viewingDistanceCm: distanceCm,
      channels,
      backgroundGray: 0,
      monocular: { leftVisible: true, rightVisible: true },
      worthFourDot: { result: 'unknown', dotsSeen: 0, notes: '' },
      clinicalPrism: knowsPrism
        ? {
            amountDelta: prismAmount,
            base: prismBase,
            range: 'distance',
            measuredOn: dayKey(),
            fusionWithPrism: 'unknown',
            notes: '',
          }
        : null,
      offset: {
        left: { dx: round(offset.dx, 1), dy: round(offset.dy, 1), rotationDeg: 0 },
        right: { ...IDENTITY_TRANSFORM },
        seededFromClinical: knowsPrism,
        splitMode: 'left',
      },
      // A middle starting point; the full calibration measures it.
      contrastBalance: { dominantEye: 'right', balanceRatio: 0.7, trials: 0 },
      postureNote: '',
    };
    await getDb().calibrations.put(profile);
    setActiveCalibration(profile.id);
    navigate('/train/l1');
  };

  return (
    <div data-testid="quick-start">
      <h1>{t('quick.title')}</h1>
      <p>{t('quick.intro')}</p>

      <Card title={t('quick.step1')}>
        <Field label={t('quick.device')}>
          <Segmented
            value={kind}
            onChange={(k) => {
              setKind(k);
              setDistanceCm(DEVICE_PRESETS[k].distanceCm);
            }}
            label={t('quick.device')}
            options={(Object.keys(DEVICE_PRESETS) as DeviceKind[]).map((k) => ({
              value: k,
              label: t(`quick.devices.${k}`),
            }))}
          />
        </Field>
        <Field label={t('quick.diagonal')} htmlFor="quick-diagonal" hint={t('quick.diagonalHint')}>
          <input
            id="quick-diagonal"
            type="number"
            inputMode="decimal"
            min={3}
            max={60}
            step={0.1}
            placeholder={String(DEVICE_PRESETS[kind].diagonalIn)}
            value={diagonal}
            onChange={(e) => setDiagonal(e.target.value)}
          />
        </Field>
        <Field label={t('quick.distance')} htmlFor="quick-distance" hint={t('quick.distanceHint')}>
          <input
            id="quick-distance"
            type="number"
            min={30}
            max={120}
            value={distanceCm}
            onChange={(e) => setDistanceCm(Number(e.target.value))}
          />
        </Field>
        <p className="hint" data-testid="quick-ppi">
          {t('quick.estimate', { ppi: Math.round(ppi), diagonal: diagonalIn })}
        </p>
      </Card>

      <Card title={t('quick.step2')}>
        <p>{t('calibration.glasses.intro')}</p>
        <p className="hint">{t('calibration.glasses.cvdHint')}</p>
        <CalibCanvas options={identity} draw={drawGlasses} testId="quick-glasses-canvas" />
        <Field label={t('calibration.glasses.question')}>
          <Segmented
            value={eyeChoice ?? ('' as 'A')}
            onChange={(v) => {
              setEyeChoice(v);
              // Right eye covered => the LEFT eye is looking. A is the red-channel square.
              const left = v === 'A' ? 'red' : 'cyan';
              setChannels({
                left: { ...DEFAULT_CHANNEL_MAP.left, channel: left },
                right: { ...DEFAULT_CHANNEL_MAP.right, channel: left === 'red' ? 'cyan' : 'red' },
              });
            }}
            label={t('calibration.glasses.question')}
            options={[
              { value: 'A', label: t('calibration.glasses.squareA') },
              { value: 'B', label: t('calibration.glasses.squareB') },
            ]}
          />
        </Field>
      </Card>

      <Card title={t('quick.step3')}>
        <label className="row">
          <input
            type="checkbox"
            checked={knowsPrism}
            onChange={(e) => setKnowsPrism(e.target.checked)}
            data-testid="quick-knows-prism"
          />
          <span>{t('quick.knowsPrism')}</span>
        </label>
        {knowsPrism ? (
          <>
            <Field label={t('calibration.prism.amount')} htmlFor="quick-prism">
              <input
                id="quick-prism"
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={prismAmount}
                onChange={(e) => setPrismAmount(Number(e.target.value))}
              />
            </Field>
            <Field label={t('calibration.prism.base')}>
              <Segmented
                value={prismBase}
                onChange={setPrismBase}
                label={t('calibration.prism.base')}
                options={(['in', 'out', 'up', 'down'] as const).map((b) => ({
                  value: b,
                  label: t(`calibration.prism.bases.${b}`),
                }))}
              />
            </Field>
            {!prismOk ? <p className="field-error">{t('calibration.prism.implausible')}</p> : null}
          </>
        ) : (
          <p className="hint">{t('quick.noPrism')}</p>
        )}
      </Card>

      <Banner tone="info">{t('quick.afterwards')}</Banner>
      <div className="row" style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          disabled={!ready || saving}
          onClick={() => void save()}
          data-testid="quick-save"
        >
          {t('quick.go')}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/calibration')}>
          {t('quick.full')}
        </Button>
      </div>
    </div>
  );
}
