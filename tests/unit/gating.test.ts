import { describe, expect, it } from 'vitest';
import { STABLE_SESSIONS_REQUIRED, evaluateGate, offsetReductionAllowed } from '../../src/safety/gating';
import { makeCheck, makeCleanPair, makeSession, makeSettings } from '../fixtures/factories';

function stableHistory(days: string[], perDay = 2) {
  const sessions = [];
  const checks = [];
  for (const d of days) {
    for (let i = 0; i < perDay; i++) {
      const { session, check } = makeCleanPair(d, i % 2 === 0 ? 'l1' : 'l2');
      sessions.push(session);
      checks.push(check);
    }
  }
  return { sessions, checks };
}

describe('module gating', () => {
  it('L1 and L2 only need disclaimer + calibration + no training lock', () => {
    const r = evaluateGate('l1', {
      settings: makeSettings(),
      sessions: [],
      checks: [],
      disclaimerVersion: 1,
    });
    expect(r.unlocked).toBe(true);
  });

  it('blocks everything when training is locked by a red flag', () => {
    const settings = makeSettings({
      trainingLock: { locked: true, reason: 'red flag', since: '2026-09-01T00:00:00.000Z' },
    });
    const r = evaluateGate('l1', { settings, sessions: [], checks: [], disclaimerVersion: 1 });
    expect(r.unlocked).toBe(false);
    expect(r.reasons).toContain('training-locked');
  });

  it('blocks when the disclaimer version has not been accepted', () => {
    const r = evaluateGate('l2', {
      settings: makeSettings({ disclaimerAcceptedVersion: null }),
      sessions: [],
      checks: [],
      disclaimerVersion: 1,
    });
    expect(r.reasons).toContain('disclaimer');
  });

  it('L3/L5 stay locked until 6 stable L1/L2 sessions across 3 days', () => {
    const two = stableHistory(['2026-09-01', '2026-09-02']);
    const r = evaluateGate('l3', { settings: makeSettings(), ...two, disclaimerVersion: 1 });
    expect(r.unlocked).toBe(false);
    expect(r.stableSessions).toBe(4);
    expect(r.reasons).toContain('needs-stable-sessions');

    const three = stableHistory(['2026-09-01', '2026-09-02', '2026-09-03']);
    const ok = evaluateGate('l3', { settings: makeSettings(), ...three, disclaimerVersion: 1 });
    expect(ok.stableSessions).toBe(STABLE_SESSIONS_REQUIRED);
    expect(ok.unlocked).toBe(true);
    expect(evaluateGate('l5', { settings: makeSettings(), ...three, disclaimerVersion: 1 }).unlocked).toBe(
      true,
    );
  });

  it('sessions with diplopia, headache or a STOP event do not count as stable', () => {
    const h = stableHistory(['2026-09-01', '2026-09-02', '2026-09-03']);
    // Make one check report diplopia "sometimes" and another session contain a stop.
    h.checks[0]!.diplopia = 2;
    h.sessions[1]!.events.push({ at: '2026-09-01T10:02:00.000Z', type: 'stop' });
    const r = evaluateGate('l3', { settings: makeSettings(), ...h, disclaimerVersion: 1 });
    expect(r.stableSessions).toBe(4);
    expect(r.unlocked).toBe(false);
  });

  it('a STOP in the last 3 sessions blocks advanced modules', () => {
    const h = stableHistory(['2026-09-01', '2026-09-02', '2026-09-03']);
    h.sessions.push(
      makeSession({
        day: '2026-09-04',
        startedAt: '2026-09-04T10:00:00.000Z',
        status: 'stopped',
        events: [{ at: '2026-09-04T10:01:00.000Z', type: 'stop' }],
      }),
    );
    const r = evaluateGate('l5', { settings: makeSettings(), ...h, disclaimerVersion: 1 });
    expect(r.reasons).toContain('recent-stop');
  });

  it('L4 vergence additionally requires clinician agreement', () => {
    const h = stableHistory(['2026-09-01', '2026-09-02', '2026-09-03']);
    const no = evaluateGate('l4', { settings: makeSettings(), ...h, disclaimerVersion: 1 });
    expect(no.reasons).toEqual(['clinician-agreement']);
    const yes = evaluateGate('l4', {
      settings: makeSettings({ clinicianAgreement: true }),
      ...h,
      disclaimerVersion: 1,
    });
    expect(yes.unlocked).toBe(true);
  });

  it('offset reduction needs clinician agreement and no progression lock', () => {
    expect(offsetReductionAllowed(makeSettings())).toBe(false);
    expect(offsetReductionAllowed(makeSettings({ clinicianAgreement: true }))).toBe(true);
    expect(
      offsetReductionAllowed(
        makeSettings({
          clinicianAgreement: true,
          progressionLock: { locked: true, reason: '', since: null },
        }),
      ),
    ).toBe(false);
  });

  it('ignores checks that are not post-session checks', () => {
    const { session } = makeCleanPair('2026-09-01');
    const pre = makeCheck({ phase: 'pre', diplopia: 4 });
    session.postCheckId = null;
    const r = evaluateGate('l3', {
      settings: makeSettings(),
      sessions: [session],
      checks: [pre],
      disclaimerVersion: 1,
    });
    expect(r.stableSessions).toBe(0);
  });
});
