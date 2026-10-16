import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ModuleId, ModuleProgress } from '../data/schema';
import type { FlashReport } from '../engine/flashDetector';
import type { ProgressChange } from '../modules/adaptive';
import type { HudState, ModuleDefinition } from '../modules/types';
import { Banner, Button, Card, Progress } from '../ui';
import type { BlockReason, PauseReason } from './sessionMachine';
import { StopButton } from './StopButton';
import { SymptomCheckForm, type SymptomCheckSubmit } from './SymptomCheckForm';

/**
 * Presentational pieces of the training screen. They hold no session logic: TrainingShell
 * owns the state machine (sessionMachine.ts) and passes in what to show.
 */

export function BlockedView({ reasons }: { reasons: BlockReason[] }) {
  const { t } = useTranslation();
  return (
    <Card title={t('training.blockedTitle')}>
      <Banner tone="warn" title={t('training.blockedIntro')}>
        <ul>
          {reasons.map((r) => (
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
        {reasons.includes('no-calibration') ? (
          <Link className="btn primary" to="/calibration">
            {t('nav.calibration')}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function formatClock(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`;
}

export interface TrainingHudProps {
  def: ModuleDefinition;
  moduleId: ModuleId;
  hud: HudState;
  elapsedMs: number;
  sessionMs: number;
  allowedMinutes: number;
  stopDisabled: boolean;
  onStop: () => void;
}

export function TrainingHud(props: TrainingHudProps) {
  const { t } = useTranslation();
  const { hud } = props;
  const pct = props.sessionMs > 0 ? props.elapsedMs / props.sessionMs : 0;
  return (
    <>
      <div className="training-hud">
        <StopButton onStop={props.onStop} disabled={props.stopDisabled} />
        <span className="hud-title">
          <b>{props.def.code}</b> {t(`modules.${props.moduleId}.name`)}
        </span>
        <span data-testid="hud-timer">
          {formatClock(props.elapsedMs)} / {props.allowedMinutes}:00
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
        {t(`modules.${props.moduleId}.controls`)}
      </div>
    </>
  );
}

export function BreakOverlay({ leftMs }: { leftMs: number }) {
  const { t } = useTranslation();
  return (
    <div className="training-overlay" role="dialog" aria-live="polite" data-testid="overlay-break">
      <div className="panel">
        <h2>{t('training.breakTitle')}</h2>
        <p>{t('training.breakBody')}</p>
        <p style={{ fontSize: '2rem', fontWeight: 700 }}>{Math.ceil(leftMs / 1000)}</p>
      </div>
    </div>
  );
}

export function PausedOverlay({ reason, onResume }: { reason: PauseReason; onResume: () => void }) {
  const { t } = useTranslation();
  const key = reason === 'idle' ? 'idle' : reason === 'vr' ? 'vrEnded' : 'paused';
  return (
    <div className="training-overlay" role="dialog" data-testid="overlay-paused">
      <div className="panel">
        <h2>{t(`training.${key}Title`)}</h2>
        <p>{t(`training.${key}Body`)}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="primary" onClick={onResume} data-testid="resume-button">
            {t('training.resume')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface FlashOverlayProps {
  report: FlashReport | null;
  canResume: boolean;
  onResume: () => void;
  onStop: () => void;
}

export function FlashOverlay({ report, canResume, onResume, onStop }: FlashOverlayProps) {
  const { t } = useTranslation();
  const unverifiable = !!report?.unverifiable;
  return (
    <div className="training-overlay" role="alertdialog" data-testid="overlay-flash">
      <div className="panel">
        <h2>{t(unverifiable ? 'training.unverifiableTitle' : 'training.flashTitle')}</h2>
        <p>
          {unverifiable
            ? t('training.unverifiableBody')
            : t('training.flashBody', { rate: report?.flashRate.toFixed(1) ?? '?' })}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {canResume ? <Button onClick={onResume}>{t('training.resume')}</Button> : null}
          <Button variant="danger" onClick={onStop}>
            {t('safety.stopButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StopOverlay({
  sessionId,
  onSubmit,
}: {
  sessionId: string | null;
  onSubmit: (r: SymptomCheckSubmit) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="training-overlay" role="dialog" data-testid="overlay-stop">
      <div
        className="panel"
        style={{ textAlign: 'left', maxWidth: 640, overflow: 'auto', maxHeight: '85vh' }}
      >
        <h2>{t('training.stoppedTitle')}</h2>
        <p>{t('training.stoppedBody')}</p>
        <SymptomCheckForm phase="stop" sessionId={sessionId} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

export interface SessionOutcome {
  steppedBack: boolean;
  progressionLocked: boolean;
  minutes: number;
  change: ProgressChange;
  next: ModuleProgress | null;
}

export function SummaryView({
  def,
  outcome,
  metrics,
}: {
  def: ModuleDefinition;
  outcome: SessionOutcome | null;
  metrics: Record<string, number>;
}) {
  const { t } = useTranslation();
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
