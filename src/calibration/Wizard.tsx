import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../data/db';
import type { CalibrationProfile, ClinicalPrism, WorthFourDotResult } from '../data/schema';
import { sanitizeText } from '../data/sanitize';
import { useSettings } from '../data/settingsStore';
import { newId, nowIso } from '../data/util';
import {
  IDENTITY_TRANSFORM,
  MAX_ROTATION_DEG,
  MAX_ROTATION_STEP_DEG,
  clampTransform,
  type EyeTransform,
} from '../engine/affine';
import { DEFAULT_CHANNEL_MAP, type EyeChannelMap, type RenderOptions } from '../engine/renderer';
import {
  createStaircase,
  staircaseRespond,
  staircaseThreshold,
  type StaircaseConfig,
} from '../engine/staircase';
import {
  isPlausibleDistanceCm,
  prismToPixelOffset,
  pxToPrismDiopters,
  round,
  type ScreenGeometry,
} from '../engine/units';
import { ErgonomicsCard } from '../safety/ErgonomicsCard';
import { Banner, Button, Card, Field, Segmented } from '../ui';
import { CalibCanvas, type CalibDraw } from './CalibCanvas';
import { PpiCardCalibration } from './PpiCardCalibration';
import { PrismInputForm, defaultClinicalPrism } from './PrismInputForm';

const STEPS = ['safety', 'screen', 'glasses', 'monocular', 'worth', 'offset', 'contrast', 'review'] as const;

const CONTRAST_STAIRCASE: StaircaseConfig = {
  start: 1,
  min: 0.05,
  max: 1,
  step: 0.1,
  up: 1,
  down: 1,
  harderDirection: -1,
  maxReversals: 6,
  stepAfterReversals: [{ reversals: 2, step: 0.05 }],
};

export function CalibrationWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [ppi, setPpi] = useState<{ widthPx: number; ppi: number } | null>(null);
  const [distanceCm, setDistanceCm] = useState(60);
  const [channels, setChannels] = useState<EyeChannelMap>(DEFAULT_CHANNEL_MAP);
  const [eyeChoice, setEyeChoice] = useState<'A' | 'B' | null>(null);
  const [backgroundGray, setBackgroundGray] = useState(0);
  const [monoLeft, setMonoLeft] = useState<boolean | null>(null);
  const [monoRight, setMonoRight] = useState<boolean | null>(null);
  const [dotsSeen, setDotsSeen] = useState<number | null>(null);
  const [alternating, setAlternating] = useState(false);
  const [w4dNotes, setW4dNotes] = useState('');
  const [prism, setPrism] = useState<ClinicalPrism>(defaultClinicalPrism());
  const [useClinical, setUseClinical] = useState(true);
  const [leftT, setLeftT] = useState<EyeTransform>({ ...IDENTITY_TRANSFORM });
  const [seeded, setSeeded] = useState(false);
  const [nudge, setNudge] = useState(5);
  const [stair, setStair] = useState(() => createStaircase(CONTRAST_STAIRCASE));
  const [equalCount, setEqualCount] = useState(0);
  const [balanceOverride, setBalanceOverride] = useState<number | null>(null);
  const [name, setName] = useState(() => `Profile ${new Date().toLocaleDateString()}`);
  const [postureNote, setPostureNote] = useState('');

  const geometry: ScreenGeometry | null = ppi ? { distanceM: distanceCm / 100, ppi: ppi.ppi } : null;
  const redEye: 'left' | 'right' = channels.left.channel === 'red' ? 'left' : 'right';
  const cyanEye: 'left' | 'right' = redEye === 'left' ? 'right' : 'left';

  const baseOptions = useMemo<RenderOptions>(
    () => ({
      transforms: { left: leftT, right: { ...IDENTITY_TRANSFORM } },
      channels,
      contrast: { left: 1, right: 1 },
      backgroundGray,
    }),
    [leftT, channels, backgroundGray],
  );
  const identityOptions = useMemo<RenderOptions>(
    () => ({
      ...baseOptions,
      transforms: { left: { ...IDENTITY_TRANSFORM }, right: { ...IDENTITY_TRANSFORM } },
    }),
    [baseOptions],
  );

  // ---- Draw callbacks ----
  const drawGlasses = useCallback<CalibDraw>(
    (l, r, w, h) => {
      // Square A drawn in the RED channel layer, square B in the CYAN channel layer.
      const redLayer = channels.left.channel === 'red' ? l : r;
      const cyanLayer = redLayer === l ? r : l;
      redLayer.fillStyle = '#fff';
      redLayer.fillRect(w * 0.15, h * 0.25, w * 0.3, h * 0.5);
      redLayer.fillStyle = '#000';
      redLayer.font = `${Math.round(h * 0.3)}px sans-serif`;
      redLayer.textAlign = 'center';
      redLayer.textBaseline = 'middle';
      redLayer.fillText('A', w * 0.3, h * 0.5);
      cyanLayer.fillStyle = '#fff';
      cyanLayer.fillRect(w * 0.55, h * 0.25, w * 0.3, h * 0.5);
      cyanLayer.fillStyle = '#000';
      cyanLayer.font = `${Math.round(h * 0.3)}px sans-serif`;
      cyanLayer.textAlign = 'center';
      cyanLayer.textBaseline = 'middle';
      cyanLayer.fillText('B', w * 0.7, h * 0.5);
    },
    [channels],
  );

  const drawGhost = useCallback<CalibDraw>((l, _r, w, h) => {
    l.fillStyle = '#fff';
    l.beginPath();
    l.arc(w * 0.5, h * 0.5, h * 0.2, 0, Math.PI * 2);
    l.fill();
  }, []);

  const drawMonoLeft = useCallback<CalibDraw>((l, _r, w, h) => {
    l.fillStyle = '#fff';
    l.beginPath();
    l.moveTo(w * 0.5, h * 0.2);
    l.lineTo(w * 0.7, h * 0.8);
    l.lineTo(w * 0.3, h * 0.8);
    l.closePath();
    l.fill();
  }, []);
  const drawMonoRight = useCallback<CalibDraw>((_l, r, w, h) => {
    r.fillStyle = '#fff';
    r.fillRect(w * 0.35, h * 0.25, w * 0.3, h * 0.5);
  }, []);

  const drawWorth = useCallback<CalibDraw>(
    (l, r, w, h) => {
      const redLayer = channels.left.channel === 'red' ? l : r;
      const cyanLayer = redLayer === l ? r : l;
      const cx = w / 2;
      const cy = h / 2;
      const rad = h * 0.07;
      const dot = (c: CanvasRenderingContext2D, x: number, y: number) => {
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(x, y, rad, 0, Math.PI * 2);
        c.fill();
      };
      dot(redLayer, cx, cy - h * 0.25); // top: red eye only
      dot(cyanLayer, cx - w * 0.15, cy); // left: cyan eye only
      dot(cyanLayer, cx + w * 0.15, cy); // right: cyan eye only
      dot(l, cx, cy + h * 0.25); // bottom: both eyes
      dot(r, cx, cy + h * 0.25);
    },
    [channels],
  );

  const drawOffset = useCallback<CalibDraw>((l, r, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    // Both eyes: fusion frame.
    for (const c of [l, r]) {
      c.strokeStyle = '#888';
      c.lineWidth = 3;
      c.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    }
    // Left eye: cross. Right eye: ring.
    l.strokeStyle = '#fff';
    l.lineWidth = 4;
    l.beginPath();
    l.moveTo(cx - h * 0.12, cy);
    l.lineTo(cx + h * 0.12, cy);
    l.moveTo(cx, cy - h * 0.12);
    l.lineTo(cx, cy + h * 0.12);
    l.stroke();
    r.strokeStyle = '#fff';
    r.lineWidth = 4;
    r.beginPath();
    r.arc(cx, cy, h * 0.08, 0, Math.PI * 2);
    r.stroke();
  }, []);

  const drawContrast = useCallback<CalibDraw>((l, r, w, h) => {
    l.fillStyle = '#fff';
    l.fillRect(w * 0.3, h * 0.2, w * 0.12, h * 0.6);
    r.fillStyle = '#fff';
    r.fillRect(w * 0.58, h * 0.2, w * 0.12, h * 0.6);
    for (const c of [l, r]) {
      c.strokeStyle = '#777';
      c.lineWidth = 2;
      c.strokeRect(w * 0.2, h * 0.1, w * 0.6, h * 0.8);
    }
  }, []);

  const contrastOptions = useMemo<RenderOptions>(
    () => ({ ...baseOptions, contrast: { left: 1, right: stair.value } }),
    [baseOptions, stair.value],
  );

  // ---- Derived ----
  const w4dResult: WorthFourDotResult = useMemo(() => {
    if (alternating) return 'alternating';
    if (dotsSeen === 4) return 'fusion';
    if (dotsSeen === 5) return 'diplopia';
    if (dotsSeen === 2) return cyanEye === 'left' ? 'left-suppression' : 'right-suppression';
    if (dotsSeen === 3) return redEye === 'left' ? 'left-suppression' : 'right-suppression';
    return 'unknown';
  }, [dotsSeen, alternating, redEye, cyanEye]);

  const seedFromClinical = () => {
    if (!geometry) return;
    const o = prismToPixelOffset({ amountDelta: prism.amountDelta, base: prism.base, eye: 'left' }, geometry);
    setLeftT({ dx: round(o.dx, 1), dy: round(o.dy, 1), rotationDeg: 0 });
    setSeeded(true);
  };

  const nudgeLeft = (dx: number, dy: number) =>
    setLeftT((tr) => clampTransform({ ...tr, dx: tr.dx + dx, dy: tr.dy + dy }));
  const rotateLeft = (deg: number) =>
    setLeftT((tr) =>
      clampTransform({
        ...tr,
        rotationDeg: Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, tr.rotationDeg + deg)),
      }),
    );

  const respondContrast = (which: 'left' | 'right' | 'equal') => {
    if (which === 'equal') {
      setEqualCount((n) => n + 1);
      if (equalCount + 1 >= 2) setBalanceOverride(stair.value);
      return;
    }
    // Right stronger -> reduce right (harder for the dominant eye); left stronger -> increase.
    setStair((s) => staircaseRespond(s, which === 'right', CONTRAST_STAIRCASE));
  };
  const balanceRatio = balanceOverride ?? (stair.done ? (staircaseThreshold(stair) ?? stair.value) : null);

  const canNext = (): boolean => {
    switch (STEPS[step]) {
      case 'safety':
        return true;
      case 'screen':
        return !!ppi && isPlausibleDistanceCm(distanceCm);
      case 'glasses':
        return eyeChoice !== null;
      case 'monocular':
        return monoLeft !== null && monoRight !== null;
      case 'worth':
        return dotsSeen !== null || alternating;
      case 'offset':
        return true;
      case 'contrast':
        return balanceRatio !== null;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const save = async () => {
    if (!ppi) return;
    const now = nowIso();
    const profile: CalibrationProfile = {
      id: newId('cal'),
      name: sanitizeText(name, 120) || 'Profile',
      createdAt: now,
      updatedAt: now,
      device: {
        ppi: ppi.ppi,
        cardWidthPx: ppi.widthPx,
        dpr: window.devicePixelRatio || 1,
        screenWidth: screen.width,
        screenHeight: screen.height,
      },
      viewingDistanceCm: distanceCm,
      channels,
      backgroundGray,
      monocular: { leftVisible: !!monoLeft, rightVisible: !!monoRight },
      worthFourDot: { result: w4dResult, dotsSeen: dotsSeen ?? 0, notes: sanitizeText(w4dNotes) },
      clinicalPrism: useClinical ? prism : null,
      offset: {
        left: leftT,
        right: { ...IDENTITY_TRANSFORM },
        seededFromClinical: seeded,
        splitMode: 'left',
      },
      contrastBalance: {
        dominantEye: 'right',
        balanceRatio: round(balanceRatio ?? 1, 2),
        trials: stair.trials.length,
      },
      postureNote: sanitizeText(postureNote, 500),
    };
    await getDb().calibrations.put(profile);
    settings.setActiveCalibration(profile.id);
    navigate('/');
  };

  const current = STEPS[step]!;
  const offsetDelta = geometry ? pxToPrismDiopters(Math.hypot(leftT.dx, leftT.dy), geometry) : 0;

  // On the offset step, arrow keys nudge the left-eye image (except while typing in a field).
  useEffect(() => {
    if (current !== 'offset') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      const stepPx = e.shiftKey ? 1 : nudge;
      setLeftT((tr) => clampTransform({ ...tr, dx: tr.dx + m[0] * stepPx, dy: tr.dy + m[1] * stepPx }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, nudge]);

  return (
    <div>
      <h1>{t('calibration.title')}</h1>
      <div className="steps" aria-label="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            {i + 1}. {t(`calibration.steps.${s}`)}
          </span>
        ))}
      </div>

      {current === 'safety' ? (
        <>
          <Banner tone="warn" title={t('disclaimer.notTreatment')}>
            {t('disclaimer.statement')}
          </Banner>
          <ErgonomicsCard compact />
        </>
      ) : null}

      {current === 'screen' ? (
        <Card title={t('calibration.steps.screen')}>
          <PpiCardCalibration initialWidthPx={ppi?.widthPx ?? null} onChange={setPpi} />
          <Field
            label={t('calibration.distance.label')}
            htmlFor="distance"
            hint={t('calibration.distance.hint')}
          >
            <input
              id="distance"
              type="number"
              min={30}
              max={120}
              value={distanceCm}
              onChange={(e) => setDistanceCm(Number(e.target.value))}
              data-testid="distance-cm"
            />
          </Field>
          {!isPlausibleDistanceCm(distanceCm) ? (
            <Banner tone="danger">{t('calibration.distance.implausible')}</Banner>
          ) : null}
        </Card>
      ) : null}

      {current === 'glasses' ? (
        <Card title={t('calibration.steps.glasses')}>
          <p>{t('calibration.glasses.intro')}</p>
          <CalibCanvas options={identityOptions} draw={drawGlasses} testId="glasses-canvas" />
          <Field label={t('calibration.glasses.question')}>
            <Segmented
              value={eyeChoice ?? ('' as 'A')}
              onChange={(v) => {
                setEyeChoice(v);
                // Right eye covered => the LEFT eye is looking. A is the red-channel square.
                const leftChannel = v === 'A' ? 'red' : 'cyan';
                setChannels({
                  left: { ...channels.left, channel: leftChannel },
                  right: { ...channels.right, channel: leftChannel === 'red' ? 'cyan' : 'red' },
                });
              }}
              label={t('calibration.glasses.question')}
              options={[
                { value: 'A', label: t('calibration.glasses.squareA') },
                { value: 'B', label: t('calibration.glasses.squareB') },
              ]}
            />
          </Field>
          {eyeChoice ? (
            <Banner tone="success">
              {t('calibration.glasses.result', {
                left: t(`calibration.glasses.${channels.left.channel}`),
                right: t(`calibration.glasses.${channels.right.channel}`),
              })}
            </Banner>
          ) : null}
          <h3>{t('calibration.ghost.title')}</h3>
          <p>{t('calibration.ghost.intro')}</p>
          <CalibCanvas options={identityOptions} draw={drawGhost} />
          <Field
            label={t('calibration.ghost.gainLeft', {
              channel: t(`calibration.glasses.${channels.left.channel}`),
            })}
            htmlFor="gain-left"
          >
            <input
              id="gain-left"
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              value={channels.left.gain}
              onChange={(e) =>
                setChannels({ ...channels, left: { ...channels.left, gain: Number(e.target.value) } })
              }
            />
          </Field>
          <Field
            label={t('calibration.ghost.gainRight', {
              channel: t(`calibration.glasses.${channels.right.channel}`),
            })}
            htmlFor="gain-right"
          >
            <input
              id="gain-right"
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              value={channels.right.gain}
              onChange={(e) =>
                setChannels({ ...channels, right: { ...channels.right, gain: Number(e.target.value) } })
              }
            />
          </Field>
          <Field
            label={t('calibration.ghost.background')}
            htmlFor="bg-gray"
            hint={t('calibration.ghost.backgroundHint')}
          >
            <input
              id="bg-gray"
              type="range"
              min={0}
              max={60}
              step={1}
              value={backgroundGray}
              onChange={(e) => setBackgroundGray(Number(e.target.value))}
            />
          </Field>
        </Card>
      ) : null}

      {current === 'monocular' ? (
        <Card title={t('calibration.steps.monocular')}>
          <p>{t('calibration.mono.introLeft')}</p>
          <CalibCanvas options={identityOptions} draw={drawMonoLeft} />
          <Segmented
            value={monoLeft === null ? ('' as 'yes') : monoLeft ? 'yes' : 'no'}
            onChange={(v) => setMonoLeft(v === 'yes')}
            label={t('calibration.mono.seeTriangle')}
            options={[
              { value: 'yes', label: t('common.yes') },
              { value: 'no', label: t('common.no') },
            ]}
          />
          <p style={{ marginTop: 16 }}>{t('calibration.mono.introRight')}</p>
          <CalibCanvas options={identityOptions} draw={drawMonoRight} />
          <Segmented
            value={monoRight === null ? ('' as 'yes') : monoRight ? 'yes' : 'no'}
            onChange={(v) => setMonoRight(v === 'yes')}
            label={t('calibration.mono.seeSquare')}
            options={[
              { value: 'yes', label: t('common.yes') },
              { value: 'no', label: t('common.no') },
            ]}
          />
          {monoLeft === false || monoRight === false ? (
            <Banner tone="warn">{t('calibration.mono.notVisible')}</Banner>
          ) : null}
        </Card>
      ) : null}

      {current === 'worth' ? (
        <Card title={t('calibration.steps.worth')}>
          <p>{t('calibration.worth.intro')}</p>
          <CalibCanvas options={identityOptions} draw={drawWorth} testId="worth-canvas" />
          <Field label={t('calibration.worth.question')}>
            <Segmented
              value={dotsSeen ?? 0}
              onChange={(v) => {
                setDotsSeen(v);
                setAlternating(false);
              }}
              label={t('calibration.worth.question')}
              options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
            />
          </Field>
          <label className="row">
            <input type="checkbox" checked={alternating} onChange={(e) => setAlternating(e.target.checked)} />
            <span>{t('calibration.worth.alternating')}</span>
          </label>
          {dotsSeen !== null || alternating ? (
            <Banner
              tone={w4dResult === 'diplopia' ? 'danger' : w4dResult === 'fusion' ? 'success' : 'info'}
              title={t(`calibration.worth.results.${w4dResult}`)}
            >
              {w4dResult === 'diplopia'
                ? t('calibration.worth.diplopiaCaution')
                : t(`calibration.worth.explain.${w4dResult}`)}
            </Banner>
          ) : null}
          <Field label={t('symptoms.notes')} htmlFor="w4d-notes">
            <textarea
              id="w4d-notes"
              value={w4dNotes}
              onChange={(e) => setW4dNotes(e.target.value)}
              maxLength={2000}
            />
          </Field>
        </Card>
      ) : null}

      {current === 'offset' ? (
        <Card title={t('calibration.steps.offset')}>
          <label className="row">
            <input type="checkbox" checked={useClinical} onChange={(e) => setUseClinical(e.target.checked)} />
            <span>{t('calibration.prism.useClinical')}</span>
          </label>
          {useClinical ? (
            <>
              <PrismInputForm value={prism} onChange={setPrism} geometry={geometry} />
              <Button variant="primary" onClick={seedFromClinical} data-testid="seed-offset">
                {t('calibration.prism.seed')}
              </Button>
            </>
          ) : null}
          <h3 style={{ marginTop: 16 }}>{t('calibration.offset.fineTitle')}</h3>
          <p>{t('calibration.offset.fineIntro')}</p>
          <p className="hint">{t('calibration.offset.keyboardHint')}</p>
          <CalibCanvas options={baseOptions} draw={drawOffset} testId="offset-canvas" />
          <div className="row">
            <Segmented
              value={nudge}
              onChange={setNudge}
              label="step"
              options={[1, 5, 20].map((n) => ({ value: n, label: `${n} px` }))}
            />
            <Button onClick={() => nudgeLeft(-nudge, 0)} aria-label="left">
              ←
            </Button>
            <Button onClick={() => nudgeLeft(nudge, 0)} aria-label="right">
              →
            </Button>
            <Button onClick={() => nudgeLeft(0, -nudge)} aria-label="up">
              ↑
            </Button>
            <Button onClick={() => nudgeLeft(0, nudge)} aria-label="down">
              ↓
            </Button>
            <Button onClick={() => setLeftT((tr) => ({ ...tr, dx: -tr.dx }))}>
              {t('calibration.offset.flipH')}
            </Button>
            <Button onClick={() => setLeftT({ ...IDENTITY_TRANSFORM })}>{t('common.reset')}</Button>
          </div>
          <p data-testid="offset-readout">
            {t('calibration.offset.readout', {
              dx: round(leftT.dx, 1),
              dy: round(leftT.dy, 1),
              delta: round(offsetDelta, 2),
            })}
          </p>
          <details>
            <summary>{t('calibration.offset.torsionTitle')}</summary>
            <Banner tone="warn">{t('calibration.offset.torsionCaution')}</Banner>
            <div className="row">
              <Button onClick={() => rotateLeft(-MAX_ROTATION_STEP_DEG)}>−{MAX_ROTATION_STEP_DEG}°</Button>
              <span>{leftT.rotationDeg.toFixed(2)}°</span>
              <Button onClick={() => rotateLeft(MAX_ROTATION_STEP_DEG)}>+{MAX_ROTATION_STEP_DEG}°</Button>
              <Button onClick={() => setLeftT((tr) => ({ ...tr, rotationDeg: 0 }))}>0°</Button>
            </div>
            <p className="hint">{t('calibration.offset.torsionEnableHint')}</p>
          </details>
        </Card>
      ) : null}

      {current === 'contrast' ? (
        <Card title={t('calibration.steps.contrast')}>
          <p>{t('calibration.contrast.intro')}</p>
          <CalibCanvas options={contrastOptions} draw={drawContrast} testId="contrast-canvas" />
          <p>
            {t('calibration.contrast.current', {
              value: Math.round(stair.value * 100),
              trials: stair.trials.length,
              reversals: stair.reversals.length,
            })}
          </p>
          <div className="row">
            <Button onClick={() => respondContrast('left')} disabled={balanceRatio !== null}>
              {t('calibration.contrast.leftStronger')}
            </Button>
            <Button onClick={() => respondContrast('equal')} disabled={balanceRatio !== null}>
              {t('calibration.contrast.equal')}
            </Button>
            <Button onClick={() => respondContrast('right')} disabled={balanceRatio !== null}>
              {t('calibration.contrast.rightStronger')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStair(createStaircase(CONTRAST_STAIRCASE));
                setEqualCount(0);
                setBalanceOverride(null);
              }}
            >
              {t('common.reset')}
            </Button>
          </div>
          {balanceRatio !== null ? (
            <Banner tone="success" title={t('calibration.contrast.doneTitle')}>
              {t('calibration.contrast.doneBody', { value: Math.round(balanceRatio * 100) })}
            </Banner>
          ) : null}
        </Card>
      ) : null}

      {current === 'review' ? (
        <Card title={t('calibration.steps.review')}>
          <Field label={t('calibration.review.name')} htmlFor="profile-name">
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label={t('calibration.review.posture')} htmlFor="posture" hint={t('training.postureHint')}>
            <input
              id="posture"
              type="text"
              value={postureNote}
              onChange={(e) => setPostureNote(e.target.value)}
              maxLength={500}
            />
          </Field>
          <table>
            <tbody>
              <tr>
                <th>PPI</th>
                <td>{ppi?.ppi}</td>
              </tr>
              <tr>
                <th>{t('calibration.distance.label')}</th>
                <td>{distanceCm} cm</td>
              </tr>
              <tr>
                <th>{t('calibration.review.channels')}</th>
                <td>
                  L: {channels.left.channel} (gain {channels.left.gain.toFixed(2)}) · R:{' '}
                  {channels.right.channel} (gain {channels.right.gain.toFixed(2)})
                </td>
              </tr>
              <tr>
                <th>Worth 4-dot</th>
                <td>{t(`calibration.worth.results.${w4dResult}`)}</td>
              </tr>
              <tr>
                <th>{t('calibration.review.offset')}</th>
                <td>
                  dx {round(leftT.dx, 1)} px, dy {round(leftT.dy, 1)} px, {round(leftT.rotationDeg, 2)}° (≈{' '}
                  {round(offsetDelta, 2)}Δ)
                  {useClinical
                    ? ` · ${t('calibration.review.clinical', { delta: prism.amountDelta, base: prism.base })}`
                    : ''}
                </td>
              </tr>
              <tr>
                <th>{t('calibration.review.balance')}</th>
                <td>{Math.round((balanceRatio ?? 1) * 100)}%</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          {t('common.back')}
        </Button>
        {current !== 'review' ? (
          <Button
            variant="primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            data-testid="wizard-next"
          >
            {t('common.next')}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void save()} data-testid="wizard-save">
            {t('calibration.review.save')}
          </Button>
        )}
      </div>
    </div>
  );
}
