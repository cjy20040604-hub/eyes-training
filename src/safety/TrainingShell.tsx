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
import { initialProgress, moveTowardTier } from '../modules/adaptive';
import { getModule } from '../modules/registry';
import type { HudState } from '../modules/types';
import { Banner, Button, Card, Progress } from '../ui';
import { allowedSessionMinutes, isBreakDue, minutesUsedOnDay } from './caps';
import { ErgonomicsCard } from './ErgonomicsCard';
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
  const [blockReasons, setBlockReasons] = useState<Array<GateReason | 'cap' | 'not-implemented'>>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [hud, setHud] = useState<HudState>({ promptKey: '', score: 0, roundProgress: null });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [breaksTaken, setBreaksTaken] = useState(0);
  const [breakLeftMs, setBreakLeftMs] = useState(0);
  const [postureNote, setPostureNote] = useState('');
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [progress, setProgress] = useState<ModuleProgress | null>(null);
  const [outcome, setOutcome] = useState<{
    steppedBack: boolean;
    progressionLocked: boolean;
    minutes: number;
  } | null>(null);
  const [flashReport, setFlashReport] = useState<FlashReport | null>(null);
  const metricsRef = useRef<(() => Record<string, number>) | null>(null);
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
    const reasons: Array<GateReason | 'cap' | 'not-implemented'> = [];
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
    await saveCheck(pre.check);
    if (Object.values(pre.redFlags).some(Boolean)) {
      await lockForRedFlag('pre-check', null);
      return;
    }
    if (pre.check.diplopia >= 3 || pre.check.headache >= 2 || pre.check.nausea >= 2) {
      setBlockReasons([]);
      setPhase('blocked');
      setBlockReasons(['cap']);
      return;
    }
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
      void completeSession('completed');
      return;
    }
    if (isBreakDue(settings.caps, elapsedMs, sessionMs, breaksTaken)) {
      setOverlay('break');
      setBreakLeftMs(settings.caps.microBreakSeconds * 1000);
      emitEvent('break-start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, phase, overlay]);

  useEffect(() => {
    if (overlay !== 'break') return;
    const timer = window.setInterval(() => {
      setBreakLeftMs((ms) => {
        if (ms <= 250) {
          clearInterval(timer);
          setBreaksTaken((b) => b + 1);
          setOverlay(null);
          emitEvent('break-end');
          return 0;
        }
        return ms - 250;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [overlay, emitEvent]);

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
    setOverlay('paused');
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
      if (fromStop) s = finalizeSession(s, 'stopped', metricsRef.current?.() ?? {});
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
    settings.setModuleProgress(id, result.progress);
    if (result.progressionLocked && !settings.progressionLock.locked) {
      settings.setProgressionLock(true, 'diplopia reported in 2 consecutive sessions');
      await recordSafetyEvent('diplopia-lock', 'diplopia in 2+ consecutive sessions', s?.id ?? null);
    }
    setOutcome({
      steppedBack: result.steppedBack,
      progressionLocked: result.progressionLocked,
      minutes: s?.actualMinutes ?? 0,
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
          <span>
            {def.code} · {t(`modules.${id}.name`)}
          </span>
          <span data-testid="hud-timer">
            {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, '0')} /{' '}
            {allowedMinutes}:00
          </span>
          <span>{t('training.score', { score: hud.score })}</span>
          <span className="spacer" />
          <span>{hud.promptKey ? t(hud.promptKey) : ''}</span>
          <div style={{ width: 120 }}>
            <Progress value={pct} />
          </div>
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
        {overlay === 'flash' ? (
          <div className="training-overlay" role="alertdialog" data-testid="overlay-flash">
            <div className="panel">
              <h2>{t('training.flashTitle')}</h2>
              <p>{t('training.flashBody', { rate: flashReport?.flashRate.toFixed(1) ?? '?' })}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Button onClick={() => setOverlay(null)}>{t('training.resume')}</Button>
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
