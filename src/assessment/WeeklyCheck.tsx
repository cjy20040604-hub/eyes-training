import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { CalibCanvas, type CalibDraw } from '../calibration/CalibCanvas';
import {
  CONTRAST_STAIRCASE,
  contrastStimulus,
  offsetStimulus,
  worthFourDotResult,
  worthStimulus,
} from '../calibration/stimuli';
import { getDb } from '../data/db';
import { useActiveCalibration, useAllData } from '../data/hooks';
import type { Assessment, SymptomCheck } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { dayKey, newId, nowIso } from '../data/util';
import { IDENTITY_TRANSFORM, clampTransform } from '../engine/affine';
import type { RenderOptions } from '../engine/renderer';
import { createStaircase, staircaseRespond, staircaseThreshold } from '../engine/staircase';
import { round, type ScreenGeometry } from '../engine/units';
import { baseRenderOptions } from '../safety/TrainingCanvas';
import { recordSafetyEvent, saveCheck } from '../safety/session';
import { StopButton } from '../safety/StopButton';
import { SymptomCheckForm, type SymptomCheckSubmit } from '../safety/SymptomCheckForm';
import { hasRedFlag, shouldLockProgression } from '../safety/symptomRules';
import { Banner, Button, Card, Field, Segmented } from '../ui';
import {
  SIDES,
  StereoProbe,
  alignmentJitter,
  baseline,
  measuresOf,
  stereoTrialImage,
  summarizeAlignment,
  type Side,
} from './checkLogic';

type Step = 'pre' | 'worth' | 'align' | 'balance' | 'stereo' | 'post' | 'result' | 'blocked' | 'stopcheck';
const MEASURE_STEPS: Step[] = ['worth', 'align', 'balance', 'stereo'];
const ALIGN_TRIALS = 2;
/** Minimum time between two stereo patterns (pattern changes stay well under 3 per second). */
const STEREO_LOCKOUT_MS = 500;

/**
 * The weekly check page: pre-check, four short measurements, post-check, results. STOP
 * (button or Esc) is available on every measurement step and saves what was measured.
 */
export function WeeklyCheck() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const { calibration, loading } = useActiveCalibration();
  const all = useAllData();
  const [step, setStep] = useState<Step>('pre');
  const [blockReason, setBlockReason] = useState<'symptoms' | null>(null);
  const preCheckRef = useRef<string | null>(null);
  const startedAt = useRef(nowIso());

  // Results gathered so far.
  const [worth, setWorth] = useState<Assessment['worth']>(null);
  const [dotsSeen, setDotsSeen] = useState<number | null>(null);
  const [alternating, setAlternating] = useState(false);
  const [alignTrial, setAlignTrial] = useState(0);
  const [alignPx, setAlignPx] = useState<{ h: number[]; v: number[] }>({ h: [], v: [] });
  const [offset, setOffset] = useState(() => alignmentJitter(0, Math.random));
  const [stair, setStair] = useState(() => createStaircase(CONTRAST_STAIRCASE));
  const [equalCount, setEqualCount] = useState(0);
  const [balance, setBalance] = useState<Assessment['balance']>(null);
  const probeRef = useRef<StereoProbe | null>(null);
  const [stereoLocked, setStereoLocked] = useState(false);
  const [stereo, setStereo] = useState<Assessment['stereo']>(null);
  const [saved, setSaved] = useState<Assessment | null>(null);

  const geometry = useMemo<ScreenGeometry | null>(
    () =>
      calibration ? { distanceM: calibration.viewingDistanceCm / 100, ppi: calibration.device.ppi } : null,
    [calibration],
  );
  const dpr = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const base = useMemo<RenderOptions | null>(
    () => (calibration ? baseRenderOptions(calibration, settings.cyclotorsionEnabled) : null),
    [calibration, settings.cyclotorsionEnabled],
  );
  const identity = useMemo<RenderOptions | null>(
    () =>
      base
        ? { ...base, transforms: { left: { ...IDENTITY_TRANSFORM }, right: { ...IDENTITY_TRANSFORM } } }
        : null,
    [base],
  );

  // The self-check depends on exact Δ / arcsec conversion: a quick calibration is not enough.
  const quick = calibration?.quality === 'quick';
  const blocked = !loading && (!calibration || quick || settings.trainingLock.locked);
  const measuring = MEASURE_STEPS.includes(step);
  const stepNumber = MEASURE_STEPS.indexOf(step) + 1;

  // ---- Assessment record ----
  const buildRecord = useCallback(
    (status: Assessment['status'], postCheckId: string | null): Assessment => ({
      id: newId('chk'),
      at: startedAt.current,
      day: dayKey(),
      calibrationId: calibration?.id ?? null,
      viewingDistanceCm: calibration?.viewingDistanceCm ?? 0,
      status,
      worth,
      alignment: geometry && alignPx.h.length ? summarizeAlignment(alignPx.h, alignPx.v, geometry) : null,
      balance,
      stereo: stereo ?? (probeRef.current && probeRef.current.trials > 0 ? probeRef.current.result() : null),
      preCheckId: preCheckRef.current,
      postCheckId,
      notes: '',
    }),
    [calibration, geometry, worth, alignPx, balance, stereo],
  );

  const lockForRedFlag = async (where: string) => {
    settings.setTrainingLock(true, `red flag reported at ${where}`);
    await recordSafetyEvent('red-flag', where, null);
    navigate('/red-flag');
  };

  const onPre = async (r: SymptomCheckSubmit) => {
    await saveCheck(r.check);
    preCheckRef.current = r.check.id;
    if (hasRedFlag(r.redFlags)) return lockForRedFlag('weekly check pre-check');
    if (r.check.diplopia >= 3 || r.check.headache >= 2 || r.check.nausea >= 2) {
      setBlockReason('symptoms');
      setStep('blocked');
      return;
    }
    startedAt.current = nowIso();
    setStep('worth');
  };

  const finishWith = async (r: SymptomCheckSubmit, status: Assessment['status']) => {
    const check: SymptomCheck = { ...r.check, phase: 'post' };
    await saveCheck(check);
    const record = buildRecord(status, check.id);
    await getDb().assessments.put(record);
    setSaved(record);
    if (hasRedFlag(r.redFlags)) return lockForRedFlag('weekly check post-check');
    const posts = [...(all.data?.checks ?? []).filter((c) => c.phase === 'post'), check].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    if (shouldLockProgression(posts) && !settings.progressionLock.locked) {
      settings.setProgressionLock(true, 'diplopia reported in 2 consecutive sessions');
      await recordSafetyEvent('diplopia-lock', 'diplopia in 2+ consecutive checks', null);
    }
    all.reload();
    setStep('result');
  };

  const onStop = useCallback(() => {
    if (!MEASURE_STEPS.includes(step)) return;
    void recordSafetyEvent('stop', 'user pressed STOP during the weekly check', null);
    setStep('stopcheck');
  }, [step]);

  // ---- Alignment: arrow keys move the left image (Shift = fine steps) ----
  const nudge = useCallback(
    (dx: number, dy: number) => setOffset((o) => ({ dx: o.dx + dx, dy: o.dy + dy })),
    [],
  );
  useEffect(() => {
    if (step !== 'align') return;
    const onKey = (e: KeyboardEvent) => {
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      const px = e.shiftKey ? 0.5 : 2;
      nudge(m[0] * px, m[1] * px);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, nudge]);

  const alignOptions = useMemo<RenderOptions | null>(() => {
    if (!base) return null;
    const l = base.transforms.left;
    return {
      ...base,
      transforms: {
        ...base.transforms,
        left: clampTransform({ ...l, dx: l.dx + offset.dx, dy: l.dy + offset.dy }),
      },
    };
  }, [base, offset]);

  const confirmAlignment = () => {
    const next = { h: [...alignPx.h, offset.dx], v: [...alignPx.v, offset.dy] };
    setAlignPx(next);
    if (next.h.length >= ALIGN_TRIALS) {
      setStep('balance');
      return;
    }
    setAlignTrial((n) => n + 1);
    setOffset(alignmentJitter(next.h.length, Math.random));
  };

  // ---- Contrast balance ----
  const balanceOptions = useMemo<RenderOptions | null>(
    () => (base ? { ...base, contrast: { left: 1, right: stair.value } } : null),
    [base, stair.value],
  );
  const respondBalance = (which: 'left' | 'right' | 'equal') => {
    let s = stair;
    let eq = equalCount;
    if (which === 'equal') eq += 1;
    else s = staircaseRespond(stair, which === 'right', CONTRAST_STAIRCASE);
    setStair(s);
    setEqualCount(eq);
    if (eq >= 2 || s.done) {
      const ratio = eq >= 2 ? s.value : (staircaseThreshold(s) ?? s.value);
      setBalance({ ratio: round(Math.max(0.05, Math.min(1, ratio)), 2), trials: s.trials.length });
      probeRef.current = geometry ? new StereoProbe(geometry, dpr) : null;
      setStep('stereo');
    }
  };

  // ---- Stereo ----
  const current = probeRef.current?.current ?? null;
  const stereoDraw = useMemo<CalibDraw>(() => {
    const trial = current;
    return (l, r, w, h) => {
      if (!geometry || !trial) return;
      const { image } = stereoTrialImage({ width: w, height: h, geometry, dpr, ...trial });
      const s = image.dotSize;
      l.fillStyle = '#fff';
      for (const p of image.left) l.fillRect(p.x, p.y, s, s);
      r.fillStyle = '#fff';
      for (const p of image.right) r.fillRect(p.x, p.y, s, s);
    };
    // A new trial (seed) means a new pattern; otherwise keep the drawing stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.seed, current?.arcsec, geometry, dpr]);

  const answerStereo = useCallback(
    (side: Side | null) => {
      const probe = probeRef.current;
      if (!probe || stereoLocked || probe.done) return;
      probe.respond(side);
      if (probe.done) {
        setStereo(probe.result());
        setStep('post');
        return;
      }
      setStereoLocked(true);
      window.setTimeout(() => setStereoLocked(false), STEREO_LOCKOUT_MS);
    },
    [stereoLocked],
  );
  useEffect(() => {
    if (step !== 'stereo') return;
    const keys: Record<string, Side> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const onKey = (e: KeyboardEvent) => {
      const side = keys[e.key];
      if (side) {
        e.preventDefault();
        answerStereo(side);
      } else if (e.key === ' ') {
        e.preventDefault();
        answerStereo(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, answerStereo]);

  // ---------------- Render ----------------
  if (loading || all.loading) return <p>{t('common.loading')}</p>;

  if (blocked || step === 'blocked') {
    return (
      <Card title={t('check.title')}>
        <Banner tone="warn" title={t('training.blockedIntro')}>
          {!calibration
            ? t('gate.no-calibration')
            : quick
              ? t('gate.needs-full-calibration')
              : settings.trainingLock.locked
                ? t('gate.training-locked')
                : t('gate.symptoms')}
        </Banner>
        <div className="row">
          <Link className="btn" to="/">
            {t('nav.overview')}
          </Link>
          {!calibration || quick ? (
            <Link className="btn primary" to="/calibration">
              {t('nav.calibration')}
            </Link>
          ) : null}
        </div>
        {blockReason ? <span className="sr-only">{blockReason}</span> : null}
      </Card>
    );
  }

  if (step === 'pre') {
    return (
      <Card title={t('check.title')}>
        <p>{t('check.intro')}</p>
        <Banner tone="info" title={t('check.howTitle')}>
          {t('check.how')}
        </Banner>
        <SymptomCheckForm
          phase="pre"
          sessionId={null}
          onSubmit={(r) => void onPre(r)}
          onCancel={() => navigate('/')}
        />
      </Card>
    );
  }

  if (step === 'result' && saved) {
    return (
      <CheckResult
        record={saved}
        all={[...(all.data?.assessments ?? []).filter((a) => a.id !== saved.id), saved]}
      />
    );
  }

  if (step === 'post') {
    return (
      <Card title={t('check.postTitle')}>
        <SymptomCheckForm phase="post" sessionId={null} onSubmit={(r) => void finishWith(r, 'completed')} />
      </Card>
    );
  }

  return (
    <div className="weekly-check" data-testid="weekly-check">
      <div className="check-bar">
        <StopButton onStop={onStop} disabled={!measuring} />
        <span className="hint" data-testid="check-step">
          {t('check.stepOf', { n: Math.max(1, stepNumber), total: MEASURE_STEPS.length })}
        </span>
      </div>

      {step === 'worth' && identity && calibration ? (
        <Card title={t('check.worthTitle')}>
          <p>{t('calibration.worth.intro')}</p>
          <CalibCanvas
            options={identity}
            draw={worthDraw(calibration.channels)}
            testId="check-worth-canvas"
          />
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
          <div className="row">
            <Button
              variant="primary"
              disabled={dotsSeen === null && !alternating}
              data-testid="check-next"
              onClick={() => {
                setWorth({
                  dotsSeen: dotsSeen ?? 0,
                  alternating,
                  result: worthFourDotResult(dotsSeen, alternating, calibration.channels),
                });
                setStep('align');
              }}
            >
              {t('common.next')}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'align' && alignOptions ? (
        <Card title={t('check.alignTitle', { n: alignTrial + 1, total: ALIGN_TRIALS })}>
          <p>{t('check.alignIntro')}</p>
          <CalibCanvas options={alignOptions} draw={offsetStimulus} testId="check-align-canvas" />
          <div className="row nudge-pad" role="group" aria-label={t('check.alignMove')}>
            <Button onClick={() => nudge(-2, 0)} data-testid="align-left" aria-label={t('check.left')}>
              ←
            </Button>
            <Button onClick={() => nudge(0, -2)} data-testid="align-up" aria-label={t('check.up')}>
              ↑
            </Button>
            <Button onClick={() => nudge(0, 2)} data-testid="align-down" aria-label={t('check.down')}>
              ↓
            </Button>
            <Button onClick={() => nudge(2, 0)} data-testid="align-right" aria-label={t('check.right')}>
              →
            </Button>
            <Button variant="primary" onClick={confirmAlignment} data-testid="align-done">
              {t('check.alignDone')}
            </Button>
          </div>
          <p className="hint">{t('check.alignKeys')}</p>
        </Card>
      ) : null}

      {step === 'balance' && balanceOptions ? (
        <Card title={t('check.balanceTitle')}>
          <p>{t('calibration.contrast.intro')}</p>
          <CalibCanvas options={balanceOptions} draw={contrastStimulus} testId="check-balance-canvas" />
          <div className="row">
            <Button onClick={() => respondBalance('left')} data-testid="balance-left">
              {t('calibration.contrast.leftStronger')}
            </Button>
            <Button onClick={() => respondBalance('equal')} data-testid="balance-equal">
              {t('calibration.contrast.equal')}
            </Button>
            <Button onClick={() => respondBalance('right')} data-testid="balance-right">
              {t('calibration.contrast.rightStronger')}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'stereo' && base && current ? (
        <Card title={t('check.stereoTitle')}>
          <p>{t('check.stereoIntro')}</p>
          <CalibCanvas options={base} draw={stereoDraw} testId="check-stereo-canvas" />
          <div className="row stereo-answers" role="group" aria-label={t('check.stereoWhere')}>
            {SIDES.map((s) => (
              <Button
                key={s}
                onClick={() => answerStereo(s)}
                disabled={stereoLocked}
                data-testid={`stereo-${s}`}
              >
                {t(`check.${s}`)}
              </Button>
            ))}
            <Button
              variant="ghost"
              onClick={() => answerStereo(null)}
              disabled={stereoLocked}
              data-testid="stereo-cant"
            >
              {t('check.cantTell')}
            </Button>
          </div>
          <p className="hint" data-testid="stereo-progress">
            {t('check.stereoProgress', { n: current.trial + 1 })}
          </p>
        </Card>
      ) : null}

      {step === 'stopcheck' ? (
        <div className="training-overlay" role="dialog" data-testid="overlay-stop">
          <div
            className="panel"
            style={{ textAlign: 'left', maxWidth: 640, overflow: 'auto', maxHeight: '85vh' }}
          >
            <h2>{t('training.stoppedTitle')}</h2>
            <p>{t('check.stoppedBody')}</p>
            <SymptomCheckForm phase="stop" sessionId={null} onSubmit={(r) => void finishWith(r, 'stopped')} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const worthDrawCache = new WeakMap<object, CalibDraw>();
function worthDraw(channels: Parameters<typeof worthStimulus>[0]): CalibDraw {
  let d = worthDrawCache.get(channels);
  if (!d) {
    d = worthStimulus(channels);
    worthDrawCache.set(channels, d);
  }
  return d;
}

function fmt(v: number | null, unit: string, digits = 1): string {
  return v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`;
}

/** Results of this check next to the baseline (first two checks) and the previous check. */
export function CheckResult({ record, all }: { record: Assessment; all: Assessment[] }) {
  const { t } = useTranslation();
  const done = all.filter((a) => a.status === 'completed').sort((a, b) => a.at.localeCompare(b.at));
  const base = baseline(all);
  const previous = [...done].reverse().find((a) => a.id !== record.id) ?? null;
  const now = measuresOf(record);
  const prev = previous ? measuresOf(previous) : null;
  const rows: Array<{ key: string; now: string; prev: string; base: string }> = [
    {
      key: 'alignment',
      now: fmt(now.alignmentDelta, 'Δ', 2),
      prev: fmt(prev?.alignmentDelta ?? null, 'Δ', 2),
      base: fmt(base?.alignmentDelta ?? null, 'Δ', 2),
    },
    {
      key: 'balance',
      now: fmt(now.balancePercent, '%', 0),
      prev: fmt(prev?.balancePercent ?? null, '%', 0),
      base: fmt(base?.balancePercent ?? null, '%', 0),
    },
    {
      key: 'stereo',
      now: fmt(now.stereoArcsec, '″', 0),
      prev: fmt(prev?.stereoArcsec ?? null, '″', 0),
      base: fmt(base?.stereoArcsec ?? null, '″', 0),
    },
    {
      key: 'worth',
      now: record.worth ? t(`calibration.worth.results.${record.worth.result}`) : '—',
      prev: previous?.worth ? t(`calibration.worth.results.${previous.worth.result}`) : '—',
      base: '—',
    },
  ];
  const inBaseline = done.findIndex((a) => a.id === record.id) < 2;
  return (
    <Card title={t(record.status === 'stopped' ? 'check.resultStoppedTitle' : 'check.resultTitle')}>
      <div data-testid="check-result">
        <p>{inBaseline ? t('check.baselineNote') : t('check.compareNote')}</p>
        <table>
          <thead>
            <tr>
              <th>{t('report.measure')}</th>
              <th>{t('check.thisCheck')}</th>
              <th>{t('check.previous')}</th>
              <th>{t('check.baseline')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{t(`check.measures.${r.key}`)}</td>
                <td>{r.now}</td>
                <td>{r.prev}</td>
                <td>{r.base}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">{t('check.meaning')}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn primary" to="/">
            {t('nav.overview')}
          </Link>
          <Link className="btn" to="/report">
            {t('nav.report')}
          </Link>
        </div>
      </div>
    </Card>
  );
}
