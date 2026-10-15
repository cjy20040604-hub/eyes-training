import { describe, expect, it } from 'vitest';
import type { FlashReport } from '../../src/engine/flashDetector';
import {
  canResume,
  initialSessionState,
  isTicking,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from '../../src/safety/sessionMachine';

const run = (...actions: SessionAction[]): SessionState =>
  actions.reduce(sessionReducer, initialSessionState);

const flash = (over: Partial<FlashReport> = {}): FlashReport => ({
  level: 'danger',
  flashRate: 3.4,
  redFlashRate: 0,
  flashingAreaFraction: 0.4,
  timestampMs: 0,
  ...over,
});

const toRunning: SessionAction[] = [
  { type: 'gate', reasons: [], ergonomicsAcknowledged: true },
  { type: 'start' },
];

/** Every running sub-state the session can be in. */
const runningStates: Array<[string, SessionState]> = [
  ['stimulus', run(...toRunning)],
  ['micro-break', run(...toRunning, { type: 'break-due' })],
  ['paused (hidden)', run(...toRunning, { type: 'pause', reason: 'hidden' })],
  ['paused (idle)', run(...toRunning, { type: 'pause', reason: 'idle' })],
  ['flash warning', run(...toRunning, { type: 'flash', report: flash() })],
  ['unverifiable flash', run(...toRunning, { type: 'flash', report: flash({ unverifiable: true }) })],
];

describe('session state machine: gate', () => {
  it('blocks with the gate reasons', () => {
    const s = run({ type: 'gate', reasons: ['cap', 'no-calibration'], ergonomicsAcknowledged: true });
    expect(s.phase).toBe('blocked');
    expect(s.blockReasons).toEqual(['cap', 'no-calibration']);
  });

  it('asks for the ergonomics card once, then the pre-check', () => {
    expect(run({ type: 'gate', reasons: [], ergonomicsAcknowledged: false }).phase).toBe('ergonomics');
    expect(
      run({ type: 'gate', reasons: [], ergonomicsAcknowledged: false }, { type: 'ergonomics-ack' }).phase,
    ).toBe('pre');
    expect(run({ type: 'gate', reasons: [], ergonomicsAcknowledged: true }).phase).toBe('pre');
  });

  it('evaluates the gate only once: later data changes do not reset a running session', () => {
    const s = run(...toRunning, { type: 'gate', reasons: ['cap'], ergonomicsAcknowledged: true });
    expect(s.phase).toBe('running');
  });

  it('symptoms reported before the session block it', () => {
    const s = run(
      { type: 'gate', reasons: [], ergonomicsAcknowledged: true },
      { type: 'pre-blocked', reason: 'symptoms' },
    );
    expect(s).toMatchObject({ phase: 'blocked', blockReasons: ['symptoms'] });
  });

  it('tracks a missing setup step until the module reports its config', () => {
    const pre = run({ type: 'gate', reasons: [], ergonomicsAcknowledged: true }, { type: 'setup-missing' });
    expect(pre.setupMissing).toBe(true);
    expect(sessionReducer(pre, { type: 'setup-ready' }).setupMissing).toBe(false);
  });
});

describe('session state machine: safety invariants', () => {
  it.each(runningStates)('STOP is accepted from %s', (_name, s) => {
    const after = sessionReducer(s, { type: 'stop' });
    expect(after.phase).toBe('stopcheck');
    expect(after.overlay).toBeNull();
  });

  it('STOP is ignored outside a running session (nothing to stop, nothing restarted)', () => {
    for (const s of [initialSessionState, run({ type: 'gate', reasons: [], ergonomicsAcknowledged: true })]) {
      expect(sessionReducer(s, { type: 'stop' })).toBe(s);
    }
  });

  it('a pause never replaces a micro-break or a flash warning', () => {
    for (const [name, s] of runningStates) {
      if (s.overlay === null) continue;
      expect(sessionReducer(s, { type: 'pause', reason: 'hidden' }), name).toBe(s);
    }
  });

  it('a flash warning covers a pause or a break (danger always wins)', () => {
    const paused = run(...toRunning, { type: 'pause', reason: 'idle' });
    expect(sessionReducer(paused, { type: 'flash', report: flash() }).overlay).toBe('flash');
    const onBreak = run(...toRunning, { type: 'break-due' });
    expect(sessionReducer(onBreak, { type: 'flash', report: flash() }).overlay).toBe('flash');
  });

  it('a warn-level flash report is remembered but does not interrupt', () => {
    const s = run(...toRunning, { type: 'flash', report: flash({ level: 'warn' }) });
    expect(s.overlay).toBeNull();
    expect(s.flash?.level).toBe('warn');
  });

  it('an unverifiable flash warning cannot be dismissed; only STOP ends it', () => {
    const s = run(...toRunning, { type: 'flash', report: flash({ unverifiable: true }) });
    expect(canResume(s)).toBe(false);
    expect(sessionReducer(s, { type: 'resume' })).toBe(s);
    expect(sessionReducer(s, { type: 'time-up' })).toBe(s);
    expect(sessionReducer(s, { type: 'stop' }).phase).toBe('stopcheck');
  });

  it('a verified flash warning and a pause can be resumed; a break cannot be skipped', () => {
    const f = run(...toRunning, { type: 'flash', report: flash() });
    expect(sessionReducer(f, { type: 'resume' }).overlay).toBeNull();
    const p = run(...toRunning, { type: 'pause', reason: 'hidden' });
    expect(sessionReducer(p, { type: 'resume' }).overlay).toBeNull();
    const b = run(...toRunning, { type: 'break-due' });
    expect(canResume(b)).toBe(false);
    expect(sessionReducer(b, { type: 'resume' })).toBe(b);
  });

  it('time only counts, and can only run out, while nothing covers the stimulus', () => {
    for (const [name, s] of runningStates) {
      expect(isTicking(s), name).toBe(s.overlay === null);
      if (s.overlay !== null) expect(sessionReducer(s, { type: 'time-up' }), name).toBe(s);
    }
    expect(sessionReducer(run(...toRunning), { type: 'time-up' }).phase).toBe('completing');
  });

  it('counts finished micro-breaks and starts the next session from zero', () => {
    const s = run(
      ...toRunning,
      { type: 'break-due' },
      { type: 'break-end' },
      { type: 'break-due' },
      { type: 'break-end' },
    );
    expect(s.breaksTaken).toBe(2);
    expect(s.overlay).toBeNull();
  });

  it('nothing restarts a stopped or completed session', () => {
    const stopped = run(...toRunning, { type: 'stop' });
    const completing = run(...toRunning, { type: 'time-up' });
    for (const s of [stopped, completing]) {
      for (const a of [
        { type: 'start' },
        { type: 'resume' },
        { type: 'break-due' },
        { type: 'pause', reason: 'hidden' },
        { type: 'stop' },
      ] as SessionAction[]) {
        expect(sessionReducer(s, a).phase).toBe(s.phase);
      }
    }
  });

  it('runs the full happy path to the summary', () => {
    const s = run(...toRunning, { type: 'time-up' }, { type: 'completed' }, { type: 'post-done' });
    expect(s.phase).toBe('summary');
  });

  it('a stop check also ends in the summary', () => {
    expect(run(...toRunning, { type: 'stop' }, { type: 'post-done' }).phase).toBe('summary');
  });
});
