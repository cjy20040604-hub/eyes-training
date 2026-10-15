import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useActiveCalibration, useAllData } from '../data/hooks';
import {
  DISCLAIMER_VERSION,
  type ModuleId,
  type ModuleProgress,
  type SessionEvent,
  type SessionRecord,
} from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { dayKey, nowIso } from '../data/util';
import type { FlashReport } from '../engine/flashDetector';
import { autoAdvance, initialProgress, moveTowardTier, type ProgressChange } from '../modules/adaptive';
import { getModule } from '../modules/registry';
import type { HudState, ModuleConfig } from '../modules/types';
import { Banner, Button, Card, Progress } from '../ui';
import { allowedSessionMinutes, isBreakDue, minutesUsedOnDay } from './caps';
import { ErgonomicsCard } from './ErgonomicsCard';
import { discomfortReported } from './symptomRules';
import { evaluateGate, type GateReason } from './gating';
import {
  applyPostCheckRules,
  createSessionRecord,
  finalizeSession,
  recordSafetyEvent,
  saveCheck,
  saveSession,
} from './session';
import { StopButton } from './StopButton';
import { SymptomCheckForm, type SymptomCheckSubmit } from './SymptomCheckForm';
import { TrainingCanvas } from './TrainingCanvas';

type Phase = 'loading' | 'blocked' | 'ergonomics' | 'pre' | 'running' | 'stopcheck' | 'post' | 'summary';
type Overlay = null | 'break' | 'flash' | 'paused';

const VALID: ModuleId[] = ['l1', 'l2', 'l3', 'l4', 'l5', 'video'];

export function TrainingShell() {
  const { moduleId } = useParams();
  const id = (VALID.includes(moduleId as ModuleId) ? moduleId : 'l1') as ModuleId;
  const def = useMemo(() => getModule(id), [id]);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const { calibration, loading: calLoading } = useActiveCalibration();
  const all = useAllData();

  const [phase, setPhase] = useState<Phase>('loading');
  const [blockReasons, setBlockReasons] = useState<
    Array<GateReason | 'cap' | 'not-implemented' | 'symptoms'>
  >([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [hud, setHud] = useState<HudState>({ promptKey: '', score: 0, roundProgress: null });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [breaksTaken, setBreaksTaken] = useState(0);
  const [breakLeftMs, setBreakLeftMs] = useState(0);
  const [postureNote, setPostureNote] = useState('');
  const [setupConfig, setSetupConfig] = useState<ModuleConfig | null>(null);
  const [setupMissing, setSetupMissing] = useState(false);
  const [pausedReason, setPausedReason] = useState<'hidden' | 'idle'>('hidden');
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [progress, setProgress] = useState<ModuleProgress | null>(null);
  const [outcome, setOutcome] = useState<{
    steppedBack: boolean;
    progressionLocked: boolean;
    minutes: number;
    change: ProgressChange;
    next: ModuleProgress | null;
  } | null>(null);
  const [flashReport, setFlashReport] = useState<FlashReport | null>(null);
  const metricsRef = useRef<(() => Record<string, number>) | null>(null);
  const stopMetricsRef = useRef<Record<string, number> | null>(null);
  const completingRef = useRef(false);
  const frameClockRef = useRef(0);
  const sessionRef = useRef<SessionRecord | null>(null);
  sessionRef.current = session;

  const plan = settings.dailyPlan[id] ?? {
    minutes: def.defaultMinutes,
    intensityTier: 'low' as const,
    enabled: true,
  };
  const plannedMinutes = Math.max(
    def.minMinutes,
    Math.min(def.maxMinutes, plan.minutes || def.defaultMinutes),
  );
  const usedToday = all.data ? minutesUsedOnDay(all.data.sessions, dayKey()) : 0;
  const allowedMinutes = allowedSessionMinutes(settings.caps, plannedMinutes, usedToday);
  const sessionMs = allowedMinutes * 60000;

  // ---- Gate evaluation ----
  useEffect(() => {
    if (calLoading || all.loading || !all.data) return;
    const reasons: Array<GateReason | 'cap' | 'not-implemented' | 'symptoms'> = [];
    if (!def.implemented) reasons.push('not-implemented');
    const gate = evaluateGate(id, {
      settings,
      sessions: all.data.sessions,
      checks: all.data.checks,
      disclaimerVersion: DISCLAIMER_VERSION,
    });
    reasons.push(...gate.reasons);
    if (!calibration && !reasons.includes('no-calibration')) reasons.push('no-calibration');
    if (allowedMinutes <= 0) reasons.push('cap');
    if (reasons.length) {
      setBlockReasons(reasons);
      setPhase('blocked');
      return;
    }
    setPhase(settings.ergonomicsAcknowledgedAt ? 'pre' : 'ergonomics');
    // Only evaluate once data is ready; later changes are handled by the session flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calLoading, all.loading, all.data, calibration]);

  const emitEvent = useCallback((type: SessionEvent['type'], data?: SessionEvent['data']) => {
    const s = sessionRef.current;
    if (!s) return;
    const next = { ...s, events: [...s.events, { at: nowIso(), type, data }] };
    sessionRef.current = next;
    setSession(next);
  }, []);

  // ---- Start session after pre-check ----
  const startSession = async (pre: SymptomCheckSubmit) => {
    if (!calibration) return;
    if (def.setup && !setupConfig) {
      setSetupMissing(true);
      window.scrollTo(0, 0);
      return;
    }
    await saveCheck(pre.check);
    if (Object.values(pre.redFlags).some(Boolean)) {
      await lockForRedFlag('pre-check', null);
      return;
    }
    if (pre.check.diplopia >= 3 || pre.check.headache >= 2 || pre.check.nausea >= 2) {
      setBlockReasons(['symptoms']);
      setPhase('blocked');
      return;
    }
    completingRef.current = false;
    stopMetricsRef.current = null;
    setBreaksTaken(0);
    setOverlay(null);
    const existing = settings.moduleProgress[id] ?? initialProgress(def, calibration, plan.intensityTier);
    const p = moveTowardTier(def, existing, plan.intensityTier, { settings, calibration });
    settings.setModuleProgress(id, p);
    setProgress(p);
    const rec = createSessionRecord({
      moduleId: id,
      calibration,
      rendererId: settings.rendererId,
      plannedMinutes: allowedMinutes,
      progress: p,
      metric: def.intensity.metric,
      postureNote,
      preCheckId: pre.check.id,
    });
    await saveSession(rec);
    sessionRef.current = rec;
    setSession(rec);
    setElapsedMs(0);
    setPhase('running');
  };

  const lockForRedFlag = async (where: string, sessionId: string | null) => {
    settings.setTrainingLock(true, `red flag reported at ${where}`);
    await recordSafetyEvent('red-flag', where, sessionId);
    navigate('/red-flag');
  };

  // ---- Timer, heartbeat, breaks, cap ----
  const running = phase === 'running' && overlay === null;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let heartbeat = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Only count training time while the stimulus is actually being drawn.
      if (now - frameClockRef.current > 750) return;
      heartbeat += dt;
      setElapsedMs((e) => e + dt);
      if (heartbeat >= 5000) {
        heartbeat = 0;
        const s = sessionRef.current;
        if (s) {
          const m = metricsRef.current?.() ?? {};
          void saveSession({ ...s, metrics: { ...m, lastHeartbeatMs: Date.now() } });
        }
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (phase !== 'running' || overlay !== null) return;
    if (elapsedMs >= sessionMs) {
      if (!completingRef.current) {
        completingRef.current = true;
        void completeSession('completed');
      }
      return;
    }
    if (isBreakDue(settings.caps, elapsedMs, sessionMs, breaksTaken)) {
      setOverlay('break');
      setBreakLeftMs(settings.caps.microBreakSeconds * 1000);
      emitEvent('break-start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, phase, overlay]);

  // Micro-break countdown. Side effects live here, never inside a state updater.
  useEffect(() => {
    if (overlay !== 'break') return;
    const endAt = performance.now() + settings.caps.microBreakSeconds * 1000;
    const timer = window.setInterval(() => {
      const left = endAt - performance.now();
      if (left <= 0) {
        window.clearInterval(timer);
        setBreakLeftMs(0);
        setBreaksTaken((b) => b + 1);
        setOverlay(null);
        emitEvent('break-end');
      } else {
        setBreakLeftMs(left);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [overlay, emitEvent, settings.caps.microBreakSeconds]);

  // Leaving the page mid-session (back button, nav link) closes the session as aborted,
  // instead of leaving it "in progress" until the next app start.
  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s && s.status === 'in-progress') {
        const metrics = stopMetricsRef.current ?? metricsRef.current?.() ?? {};
        void saveSession(finalizeSession(s, 'aborted', metrics));
      }
    },
    [],
  );

  // Pause the session (timer and stimulus) when the window is hidden; resume on request.
  useEffect(() => {
    if (phase !== 'running') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setPausedReason('hidden');
        setOverlay((o) => (o === null ? 'paused' : o));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [phase]);

  useEffect(() => {
    if (overlay === 'paused' && phase === 'running') emitEvent('pause');
  }, [overlay, phase, emitEvent]);

  const onFlash = useCallback(
    (report: FlashReport) => {
      setFlashReport(report);
      if (report.level === 'danger') {
        setOverlay('flash');
        emitEvent('flash-pause', { rate: report.flashRate, red: report.redFlashRate });
        void recordSafetyEvent(
          'flash-pause',
          `rate=${report.flashRate.toFixed(1)}/s`,
          sessionRef.current?.id ?? null,
        );
      } else if (report.level === 'warn') {
        emitEvent('flash-warn', { rate: report.flashRate });
      }
    },
    [emitEvent],
  );

  // ---- STOP ----
  const onStop = useCallback(() => {
    if (phase !== 'running') return;
    // Capture metrics now: the stimulus unmounts as soon as the phase changes.
    stopMetricsRef.current = metricsRef.current?.() ?? null;
    setOverlay(null);
    emitEvent('stop');
    void recordSafetyEvent('stop', 'user pressed STOP', sessionRef.current?.id ?? null);
    setPhase('stopcheck');
  }, [phase, emitEvent]);

  const completeSession = async (status: SessionRecord['status']) => {
    const s = sessionRef.current;
    if (!s) return;
    const final = finalizeSession(s, status, metricsRef.current?.() ?? {});
    sessionRef.current = final;
    setSession(final);
    await saveSession(final);
    if (status === 'completed') {
      const used = usedToday + final.actualMinutes;
      if (used >= settings.caps.dailyCapMinutes) {
        emitEvent('cap-hit');
        await recordSafetyEvent(
          'cap-hit',
          `daily cap ${settings.caps.dailyCapMinutes} min reached`,
          final.id,
        );
      }
    }
    setPhase('post');
  };

  const onPostCheck = async (submit: SymptomCheckSubmit, fromStop: boolean) => {
    if (!calibration || !progress) return;
    const check = { ...submit.check, phase: 'post' as const };
    await saveCheck(check);
    let s = sessionRef.current;
    if (s) {
      if (fromStop) s = finalizeSession(s, 'stopped', stopMetricsRef.current ?? {});
      s = { ...s, postCheckId: check.id };
      sessionRef.current = s;
      setSession(s);
      await saveSession(s);
    }
    const posts = [...(all.data?.checks ?? []).filter((c) => c.phase === 'post'), check].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    const result = applyPostCheckRules({
      def,
      check,
      redFlags: submit.redFlags,
      progress,
      calibration,
      settings,
      postChecksNewestFirst: posts,
    });
    let nextProgress = result.progress;
    let change: ProgressChange = null;
    const progressionLockedNow = result.progressionLocked || settings.progressionLock.locked;
    if (
      !fromStop &&
      s?.status === 'completed' &&
      !discomfortReported(check) &&
      !result.trainingLocked &&
      !progressionLockedNow
    ) {
      const perf = def.assess(s.metrics, s.actualMinutes);
      const adv = autoAdvance(def, result.progress, perf, plan.intensityTier, {
        settings,
        calibration,
      });
      nextProgress = adv.progress;
      change = adv.change;
      if (s) {
        s = { ...s, notes: `performance=${perf}${change ? `; next=${change}` : ''}` };
        sessionRef.current = s;
        setSession(s);
        await saveSession(s);
      }
    }
    settings.setModuleProgress(id, nextProgress);
    if (result.progressionLocked && !settings.progressionLock.locked) {
      settings.setProgressionLock(true, 'diplopia reported in 2 consecutive sessions');
      await recordSafetyEvent('diplopia-lock', 'diplopia in 2+ consecutive sessions', s?.id ?? null);
    }
    setOutcome({
      steppedBack: result.steppedBack,
      progressionLocked: result.progressionLocked,
      minutes: s?.actualMinutes ?? 0,
      change,
      next: nextProgress,
    });
    if (result.trainingLocked) {
      await lockForRedFlag('post-check', s?.id ?? null);
      return;
    }
    setPhase('summary');
  };

  // ---------------- Render ----------------
  if (phase === 'loading') return <p>{t('common.loading')}</p>;

  if (phase === 'blocked') {
    return (
      <Card title={t('training.blockedTitle')}>
        <Banner tone="warn" title={t('training.blockedIntro')}>
          <ul>
            {blockReasons.map((r) => (
              <li key={r} data-testid={`block-${r}`}>
                {t(`gate.${r}`)}
              </li>
            ))}
          </ul>
        </Banner>
        <div className="row">
          <Link className="btn" to="/">
            {t('nav.overview')}
          </Link>
          {blockReasons.includes('no-calibration') ? (
            <Link className="btn primary" to="/calibration">
              {t('nav.calibration')}
            </Link>
          ) : null}
        </div>
      </Card>
    );
  }

  if (phase === 'ergonomics') {
    return (
      <ErgonomicsCard
        onAcknowledge={() => {
          settings.acknowledgeErgonomics();
          setPhase('pre');
        }}
      />
    );
  }

  if (phase === 'pre') {
    return (
      <Card title={t('training.preTitle', { code: def.code, name: t(`modules.${id}.name`) })}>
        <Banner tone="info">
          {t('training.preInfo', {
            minutes: allowedMinutes,
            distance: calibration?.viewingDistanceCm ?? '?',
          })}
        </Banner>
        {def.setup ? (
          <>
            <def.setup
              onChange={(c) => {
                setSetupConfig(c);
                if (c) setSetupMissing(false);
              }}
            />
            {setupMissing ? (
              <Banner tone="warn" role="alert">
                {t('training.setupMissing')}
              </Banner>
            ) : null}
          </>
        ) : null}
        <div className="field">
          <label htmlFor="posture-note">{t('training.postureNote')}</label>
          <input
            id="posture-note"
            type="text"
            value={postureNote}
            onChange={(e) => setPostureNote(e.target.value)}
            maxLength={500}
          />
          <span className="hint">{t('training.postureHint')}</span>
        </div>
        <SymptomCheckForm
          phase="pre"
          sessionId={null}
          onSubmit={(r) => void startSession(r)}
          onCancel={() => navigate('/')}
        />
      </Card>
    );
  }

  if (phase === 'running' || phase === 'stopcheck') {
    const pct = sessionMs > 0 ? elapsedMs / sessionMs : 0;
    return (
      <div className="training-screen" data-testid="training-screen">
        <div className="training-hud">
          <StopButton onStop={onStop} disabled={phase !== 'running'} />
          <span className="hud-title">
            <b>{def.code}</b> {t(`modules.${id}.name`)}
          </span>
          <span data-testid="hud-timer">
            {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, '0')} /{' '}
            {allowedMinutes}:00
          </span>
          <span data-testid="hud-score">{t('training.score', { score: hud.score })}</span>
          <span className="spacer" />
          <span data-testid="hud-prompt" aria-live="polite">
            {hud.promptKey ? t(hud.promptKey, hud.promptParams ?? {}) : ''}
          </span>
          {hud.roundProgress !== null ? (
            <div style={{ width: 90 }} title={t('training.holdProgress')}>
              <Progress value={hud.roundProgress} />
            </div>
          ) : null}
          <div style={{ width: 120 }} title={t('training.sessionProgress')}>
            <Progress value={pct} />
          </div>
        </div>
        <div className="training-help" data-testid="training-help">
          {t(`modules.${id}.controls`)}
        </div>
        {phase === 'running' && calibration && progress ? (
          <TrainingCanvas
            def={def}
            calibration={calibration}
            rendererId={settings.rendererId}
            intensityValue={progress.intensityValue}
            gameDifficulty={progress.gameDifficulty}
            reducedMotion={settings.reducedMotion}
            cyclotorsionEnabled={settings.cyclotorsionEnabled}
            running={overlay === null}
            onHud={setHud}
            onFlash={onFlash}
            onEvent={emitEvent}
            metricsRef={metricsRef}
            frameClockRef={frameClockRef}
            config={setupConfig ?? {}}
            onIdle={() => {
              setPausedReason('idle');
              setOverlay((o) => (o === null ? 'paused' : o));
            }}
          />
        ) : null}
        {overlay === 'break' ? (
          <div className="training-overlay" role="dialog" aria-live="polite" data-testid="overlay-break">
            <div className="panel">
              <h2>{t('training.breakTitle')}</h2>
              <p>{t('training.breakBody')}</p>
              <p style={{ fontSize: '2rem', fontWeight: 700 }}>{Math.ceil(breakLeftMs / 1000)}</p>
            </div>
          </div>
        ) : null}
        {overlay === 'paused' && phase === 'running' ? (
          <div className="training-overlay" role="dialog" data-testid="overlay-paused">
            <div className="panel">
              <h2>{t(pausedReason === 'idle' ? 'training.idleTitle' : 'training.pausedTitle')}</h2>
              <p>{t(pausedReason === 'idle' ? 'training.idleBody' : 'training.pausedBody')}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setOverlay(null);
                    emitEvent('resume');
                  }}
                  data-testid="resume-button"
                >
                  {t('training.resume')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {overlay === 'flash' ? (
          <div className="training-overlay" role="alertdialog" data-testid="overlay-flash">
            <div className="panel">
              <h2>{t(flashReport?.unverifiable ? 'training.unverifiableTitle' : 'training.flashTitle')}</h2>
              <p>
                {flashReport?.unverifiable
                  ? t('training.unverifiableBody')
                  : t('training.flashBody', { rate: flashReport?.flashRate.toFixed(1) ?? '?' })}
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                {flashReport?.unverifiable ? null : (
                  <Button onClick={() => setOverlay(null)}>{t('training.resume')}</Button>
                )}
                <Button variant="danger" onClick={onStop}>
                  {t('safety.stopButton')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {phase === 'stopcheck' ? (
          <div className="training-overlay" role="dialog" data-testid="overlay-stop">
            <div
              className="panel"
              style={{ textAlign: 'left', maxWidth: 640, overflow: 'auto', maxHeight: '85vh' }}
            >
              <h2>{t('training.stoppedTitle')}</h2>
              <p>{t('training.stoppedBody')}</p>
              <SymptomCheckForm
                phase="stop"
                sessionId={session?.id ?? null}
                onSubmit={(r) => void onPostCheck(r, true)}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === 'post') {
    return (
      <Card title={t('training.postTitle')}>
        <SymptomCheckForm
          phase="post"
          sessionId={session?.id ?? null}
          onSubmit={(r) => void onPostCheck(r, false)}
        />
      </Card>
    );
  }

  const metrics = session?.metrics ?? {};
  return (
    <Card title={t('training.summaryTitle')}>
      <p data-testid="summary-minutes">
        {t('training.summaryMinutes', { minutes: (outcome?.minutes ?? 0).toFixed(1) })}
      </p>
      {outcome?.steppedBack ? (
        <Banner tone="warn" title={t('training.steppedBackTitle')}>
          {t('training.steppedBackBody')}
        </Banner>
      ) : null}
      {outcome?.progressionLocked ? (
        <Banner tone="danger" title={t('training.progressionLockTitle')}>
          {t('training.progressionLockBody')}
        </Banner>
      ) : null}
      {(metrics['farConfirms'] ?? 0) >= 3 ? (
        <div data-testid="summary-recalibrate">
          <Banner tone="warn" title={t('training.recalibrateTitle')}>
            {t('training.recalibrateBody')}
          </Banner>
        </div>
      ) : null}
      {outcome?.change && outcome.next ? (
        <div data-testid="summary-change">
          <Banner
            tone={outcome.change === 'game-down' ? 'warn' : 'success'}
            title={t(`training.change.${outcome.change}.title`)}
          >
            {t(`training.change.${outcome.change}.body`, {
              game: outcome.next.gameDifficulty,
              value: def.intensity.format(outcome.next.intensityValue),
            })}
          </Banner>
        </div>
      ) : null}
      <Banner tone="info" title={t('training.afterTitle')}>
        {t('training.afterBody')}
      </Banner>
      <table>
        <tbody>
          {Object.entries(metrics)
            .filter(([k]) => k !== 'lastHeartbeatMs')
            .map(([k, v]) => (
              <tr key={k}>
                <th>{t(`metrics.${k}`, { defaultValue: k })}</th>
                <td>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn primary" to="/">
          {t('nav.overview')}
        </Link>
      </div>
    </Card>
  );
}
