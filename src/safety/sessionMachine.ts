import type { FlashReport } from '../engine/flashDetector';
import type { GateReason } from './gating';

/**
 * The training session lifecycle as a pure state machine.
 *
 *   loading ─gate─▶ blocked | ergonomics ─ack─▶ pre ─start─▶ running ─time-up─▶ completing ─completed─▶ post ─post-done─▶ summary
 *                                                 │                │
 *                                                 └─pre-blocked─▶ blocked     └─stop─▶ stopcheck ─post-done─▶ summary
 *
 * While running, at most one overlay is shown: a micro-break, a pause (window hidden or
 * idle), or a flash warning. Side effects (saving, events, navigation) stay in
 * TrainingShell; this reducer only decides which transitions are allowed, so the safety
 * rules below can be unit-tested without rendering anything:
 *  - STOP is accepted from every running state, whatever overlay is showing.
 *  - A pause never replaces a break or a flash warning.
 *  - A flash warning that could not be verified cannot be dismissed; only STOP ends it.
 *  - Session time can only run out while nothing covers the stimulus.
 *  - Nothing restarts a session once it has stopped or completed.
 */
export type SessionPhase =
  'loading' | 'blocked' | 'ergonomics' | 'pre' | 'running' | 'completing' | 'stopcheck' | 'post' | 'summary';

export type SessionOverlay = null | 'break' | 'flash' | 'paused';
export type PauseReason = 'hidden' | 'idle' | 'vr';
export type BlockReason = GateReason | 'cap' | 'not-implemented' | 'symptoms';

export interface SessionState {
  phase: SessionPhase;
  overlay: SessionOverlay;
  pausedReason: PauseReason;
  /** The last flash report (warn or danger) in this session. */
  flash: FlashReport | null;
  blockReasons: BlockReason[];
  breaksTaken: number;
  /** The module's setup step (e.g. choosing a video) has not been completed. */
  setupMissing: boolean;
}

export type SessionAction =
  | { type: 'gate'; reasons: BlockReason[]; ergonomicsAcknowledged: boolean }
  | { type: 'ergonomics-ack' }
  | { type: 'setup-missing' }
  | { type: 'setup-ready' }
  | { type: 'pre-blocked'; reason: 'symptoms' }
  | { type: 'start' }
  | { type: 'break-due' }
  | { type: 'break-end' }
  | { type: 'pause'; reason: PauseReason }
  | { type: 'resume' }
  | { type: 'flash'; report: FlashReport }
  | { type: 'stop' }
  | { type: 'time-up' }
  | { type: 'completed' }
  | { type: 'post-done' };

export const initialSessionState: SessionState = {
  phase: 'loading',
  overlay: null,
  pausedReason: 'hidden',
  flash: null,
  blockReasons: [],
  breaksTaken: 0,
  setupMissing: false,
};

/** True while the stimulus is shown and session time counts. */
export function isTicking(s: SessionState): boolean {
  return s.phase === 'running' && s.overlay === null;
}

/** Whether the current overlay may be dismissed with "Resume". */
export function canResume(s: SessionState): boolean {
  if (s.phase !== 'running') return false;
  if (s.overlay === 'paused') return true;
  return s.overlay === 'flash' && !s.flash?.unverifiable;
}

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'gate':
      if (s.phase !== 'loading') return s;
      if (a.reasons.length) return { ...s, phase: 'blocked', blockReasons: a.reasons };
      return { ...s, phase: a.ergonomicsAcknowledged ? 'pre' : 'ergonomics' };
    case 'ergonomics-ack':
      return s.phase === 'ergonomics' ? { ...s, phase: 'pre' } : s;
    case 'setup-missing':
      return s.phase === 'pre' ? { ...s, setupMissing: true } : s;
    case 'setup-ready':
      return s.setupMissing ? { ...s, setupMissing: false } : s;
    case 'pre-blocked':
      return s.phase === 'pre' ? { ...s, phase: 'blocked', blockReasons: [a.reason] } : s;
    case 'start':
      if (s.phase !== 'pre') return s;
      return { ...s, phase: 'running', overlay: null, flash: null, breaksTaken: 0, setupMissing: false };
    case 'break-due':
      return isTicking(s) ? { ...s, overlay: 'break' } : s;
    case 'break-end':
      if (s.phase !== 'running' || s.overlay !== 'break') return s;
      return { ...s, overlay: null, breaksTaken: s.breaksTaken + 1 };
    case 'pause':
      return isTicking(s) ? { ...s, overlay: 'paused', pausedReason: a.reason } : s;
    case 'resume':
      return canResume(s) ? { ...s, overlay: null } : s;
    case 'flash':
      if (s.phase !== 'running') return s;
      if (a.report.level === 'danger') return { ...s, overlay: 'flash', flash: a.report };
      return { ...s, flash: a.report };
    case 'stop':
      return s.phase === 'running' ? { ...s, phase: 'stopcheck', overlay: null } : s;
    case 'time-up':
      return isTicking(s) ? { ...s, phase: 'completing' } : s;
    case 'completed':
      return s.phase === 'completing' ? { ...s, phase: 'post' } : s;
    case 'post-done':
      return s.phase === 'post' || s.phase === 'stopcheck' ? { ...s, phase: 'summary', overlay: null } : s;
  }
}
