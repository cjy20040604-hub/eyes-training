import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
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
import { Banner, Card } from '../ui';
import { allowedSessionMinutes, isBreakDue, minutesUsedOnDay } from './caps';
import { ErgonomicsCard } from './ErgonomicsCard';
import { evaluateGate } from './gating';
import {
  applyPostCheckRules,
  createSessionRecord,
  finalizeSession,
  recordSafetyEvent,
  saveCheck,
  saveSession,
} from './session';
import {
  canResume,
  initialSessionState,
  isTicking,
  sessionReducer,
  type BlockReason,
} from './sessionMachine';
import { discomfortReported } from './symptomRules';
import { SymptomCheckForm, type SymptomCheckSubmit } from './SymptomCheckForm';
import { TrainingCanvas } from './TrainingCanvas';
import {
  BlockedView,
  BreakOverlay,
  FlashOverlay,
  PausedOverlay,
  StopOverlay,
  SummaryView,
  TrainingHud,
  type SessionOutcome,
} from './TrainingViews';

const VALID: ModuleId[] = ['l1', 'l2', 'l3', 'l4', 'l5', 'video'];

/**
 * One training session: gate → ergonomics → pre-check → stimulus → post-check → summary.
 * Which transitions are allowed lives in sessionMachine.ts; this component runs the side
 * effects (timers, saving, safety events) and composes the views from TrainingViews.tsx.
 */
export function TrainingShell() {
  const { moduleId } = useParams();
  const id = (VALID.includes(moduleId as ModuleId) ? moduleId : 'l1') as ModuleId;
  const def = useMemo(() => getModule(id), [id]);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const { calibration, loading: calLoading } = useActiveCalibration();
  const all = useAllData();

  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const { phase, overlay } = state;
  const [hud, setHud] = useState<HudState>({ promptKey: '', score: 0, roundProgress: null });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [breakLeftMs, setBreakLeftMs] = useState(0);
  const [postureNote, setPostureNote] = useState('');
  const [setupConfig, setSetupConfig] = useState<ModuleConfig | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [progress, setProgress] = useState<ModuleProgress | null>(null);
  const [outcome, setOutcome] = useState<SessionOutcome | null>(null);
  const metricsRef = useRef<(() => Record<string, number>) | null>(null);
  /** Metrics captured when the session ends (STOP or time up), before the stimulus unmounts. */
  const finalMetricsRef = useRef<Record<string, number> | null>(null);
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

  // ---- Gate evaluation (once data is ready; later changes are handled by the session flow) ----
  useEffect(() => {
    if (calLoading || all.loading || !all.data) return;
    const reasons: BlockReason[] = [];
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
    dispatch({ type: 'gate', reasons, ergonomicsAcknowledged: !!settings.ergonomicsAcknowledgedAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calLoading, all.loading, all.data, calibration]);

  const emitEvent = useCallback((type: SessionEvent['type'], data?: SessionEvent['data']) => {
    const s = sessionRef.current;
    if (!s) return;
    const next = { ...s, events: [...s.events, { at: nowIso(), type, data }] };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const lockForRedFlag = async (where: string, sessionId: string | null) => {
    settings.setTrainingLock(true, `red flag reported at ${where}`);
    await recordSafetyEvent('red-flag', where, sessionId);
    navigate('/red-flag');
  };

  // ---- Start session after the pre-check ----
  const startSession = async (pre: SymptomCheckSubmit) => {
    if (!calibration) return;
    if (def.setup && !setupConfig) {
      dispatch({ type: 'setup-missing' });
      window.scrollTo(0, 0);
      return;
    }
    await saveCheck(pre.check);
    if (Object.values(pre.redFlags).some(Boolean)) {
      await lockForRedFlag('pre-check', null);
      return;
    }
    if (pre.check.diplopia >= 3 || pre.check.headache >= 2 || pre.check.nausea >= 2) {
      dispatch({ type: 'pre-blocked', reason: 'symptoms' });
      return;
    }
    finalMetricsRef.current = null;
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
    dispatch({ type: 'start' });
  };

  // ---- Timer and heartbeat: count only while the stimulus is shown and actually drawn ----
  const ticking = isTicking(state);
  useEffect(() => {
    if (!ticking) return;
    let last = performance.now();
    let heartbeat = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
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
  }, [ticking]);

  // ---- Session end and micro-breaks ----
  useEffect(() => {
    if (!ticking) return;
    if (elapsedMs >= sessionMs) {
      finalMetricsRef.current = metricsRef.current?.() ?? null;
      dispatch({ type: 'time-up' });
      return;
    }
    if (isBreakDue(settings.caps, elapsedMs, sessionMs, state.breaksTaken)) {
      dispatch({ type: 'break-due' });
      setBreakLeftMs(settings.caps.microBreakSeconds * 1000);
      emitEvent('break-start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, ticking]);

  // Micro-break countdown. Side effects live here, never inside a state updater.
  useEffect(() => {
    if (overlay !== 'break') return;
    const endAt = performance.now() + settings.caps.microBreakSeconds * 1000;
    const timer = window.setInterval(() => {
      const left = endAt - performance.now();
      if (left <= 0) {
        window.clearInterval(timer);
        setBreakLeftMs(0);
        dispatch({ type: 'break-end' });
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
        const metrics = finalMetricsRef.current ?? metricsRef.current?.() ?? {};
        void saveSession(finalizeSession(s, 'aborted', metrics));
      }
    },
    [],
  );

  // Pause (timer and stimulus) when the window is hidden; the user resumes explicitly.
  useEffect(() => {
    if (phase !== 'running') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dispatch({ type: 'pause', reason: 'hidden' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [phase]);

  useEffect(() => {
    if (overlay === 'paused' && phase === 'running') emitEvent('pause');
  }, [overlay, phase, emitEvent]);

  const onFlash = useCallback(
    (report: FlashReport) => {
      dispatch({ type: 'flash', report });
      if (report.level === 'danger') {
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

  // ---- STOP: accepted from every running state, whatever overlay is showing ----
  const onStop = useCallback(() => {
    if (phase !== 'running') return;
    // Capture metrics now: the stimulus unmounts as soon as the phase changes.
    finalMetricsRef.current = metricsRef.current?.() ?? null;
    emitEvent('stop');
    void recordSafetyEvent('stop', 'user pressed STOP', sessionRef.current?.id ?? null);
    dispatch({ type: 'stop' });
  }, [phase, emitEvent]);

  const onResume = () => {
    if (!canResume(state)) return;
    dispatch({ type: 'resume' });
    if (overlay === 'paused') emitEvent('resume');
  };

  // ---- Time is up: close the session once, then ask the post-session check ----
  useEffect(() => {
    if (phase !== 'completing') return;
    const s = sessionRef.current;
    if (!s) return;
    void (async () => {
      const final = finalizeSession(s, 'completed', finalMetricsRef.current ?? {});
      sessionRef.current = final;
      setSession(final);
      await saveSession(final);
      if (usedToday + final.actualMinutes >= settings.caps.dailyCapMinutes) {
        emitEvent('cap-hit');
        await recordSafetyEvent(
          'cap-hit',
          `daily cap ${settings.caps.dailyCapMinutes} min reached`,
          final.id,
        );
      }
      dispatch({ type: 'completed' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onPostCheck = async (submit: SymptomCheckSubmit, fromStop: boolean) => {
    if (!calibration || !progress) return;
    const check = { ...submit.check, phase: 'post' as const };
    await saveCheck(check);
    let s = sessionRef.current;
    if (s) {
      if (fromStop) s = finalizeSession(s, 'stopped', finalMetricsRef.current ?? {});
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
      const adv = autoAdvance(def, result.progress, perf, plan.intensityTier, { settings, calibration });
      nextProgress = adv.progress;
      change = adv.change;
      s = { ...s, notes: `performance=${perf}${change ? `; next=${change}` : ''}` };
      sessionRef.current = s;
      setSession(s);
      await saveSession(s);
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
    dispatch({ type: 'post-done' });
  };

  // ---------------- Render ----------------
  if (phase === 'loading') return <p>{t('common.loading')}</p>;

  if (phase === 'blocked') return <BlockedView reasons={state.blockReasons} />;

  if (phase === 'ergonomics') {
    return (
      <ErgonomicsCard
        onAcknowledge={() => {
          settings.acknowledgeErgonomics();
          dispatch({ type: 'ergonomics-ack' });
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
                if (c) dispatch({ type: 'setup-ready' });
              }}
            />
            {state.setupMissing ? (
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

  if (phase === 'running' || phase === 'completing' || phase === 'stopcheck') {
    return (
      <div className="training-screen" data-testid="training-screen">
        <TrainingHud
          def={def}
          moduleId={id}
          hud={hud}
          elapsedMs={elapsedMs}
          sessionMs={sessionMs}
          allowedMinutes={allowedMinutes}
          stopDisabled={phase !== 'running'}
          onStop={onStop}
        />
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
            onIdle={() => dispatch({ type: 'pause', reason: 'idle' })}
          />
        ) : null}
        {overlay === 'break' ? <BreakOverlay leftMs={breakLeftMs} /> : null}
        {overlay === 'paused' && phase === 'running' ? (
          <PausedOverlay reason={state.pausedReason} onResume={onResume} />
        ) : null}
        {overlay === 'flash' ? (
          <FlashOverlay
            report={state.flash}
            canResume={canResume(state)}
            onResume={onResume}
            onStop={onStop}
          />
        ) : null}
        {phase === 'stopcheck' ? (
          <StopOverlay sessionId={session?.id ?? null} onSubmit={(r) => void onPostCheck(r, true)} />
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

  return <SummaryView def={def} outcome={outcome} metrics={session?.metrics ?? {}} />;
}
