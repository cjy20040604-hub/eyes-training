import { describe, expect, it } from 'vitest';
import { estimatePpi } from '../../src/calibration/QuickStart';
import {
  bothEyesReported,
  sessionCatch,
  sessionInconsistencies,
  summarizeConsistency,
} from '../../src/data/consistency';
import type { ErrorLogEntry } from '../../src/data/errorLog';
import { ISSUES_URL, buildErrorReport, issueUrl } from '../../src/data/errorReport';
import { CatchTrials } from '../../src/engine/catchTrials';
import { mulberry32 } from '../../src/engine/random';
import { evaluateGate } from '../../src/safety/gating';
import { defaultSettings } from '../../src/data/schema';
import { makeSession } from '../fixtures/factories';

const opts = { minGapMs: 1000, maxGapMs: 1000, showMs: 500, graceMs: 200 };

describe('one-eye check points', () => {
  it('appear after the gap, alternate eyes in balanced pairs, and count hits', () => {
    const c = new CatchTrials(mulberry32(1), opts);
    const eyes: string[] = [];
    for (let i = 0; i < 4; i++) {
      c.update(1000);
      expect(c.current).not.toBeNull();
      eyes.push(c.current!.eye);
      expect(c.respond()).toBe('hit');
      expect(c.current).toBeNull();
    }
    expect(eyes.filter((e) => e === 'left')).toHaveLength(2);
    expect(c.metrics()).toMatchObject({
      catchShownLeft: 2,
      catchShownRight: 2,
      catchHitLeft: 2,
      catchHitRight: 2,
    });
  });

  it('a missed symbol disappears; a press just after it still counts; later presses are false alarms', () => {
    const c = new CatchTrials(mulberry32(2), opts);
    c.update(1000);
    const eye = c.current!.eye;
    c.update(500); // shown for its full time, not answered
    expect(c.current).toBeNull();
    c.update(100);
    expect(c.respond()).toBe('late-hit');
    expect(c.respond()).toBe('false-alarm');
    const m = c.metrics();
    expect(eye === 'left' ? m.catchHitLeft : m.catchHitRight).toBe(1);
    expect(m.catchFalseAlarms).toBe(1);
  });

  it('only runs while the stimulus does, and respects a veto (the transition guard)', () => {
    const c = new CatchTrials(mulberry32(3), opts);
    c.update(999);
    expect(c.current).toBeNull();
    c.update(10, () => false);
    expect(c.current).toBeNull();
    c.update(10, () => true);
    expect(c.current).not.toBeNull();
    expect(c.current!.u === 0.1 || c.current!.u === 0.9).toBe(true);
  });
});

describe('report consistency', () => {
  const l3 = (m: Record<string, number>) => makeSession({ moduleId: 'l3', metrics: m });

  it('reads L1’s chick as the left-eye check', () => {
    const s = makeSession({ moduleId: 'l1', metrics: { probesShown: 4, probesHit: 3, probeFalseAlarms: 1 } });
    expect(sessionCatch(s)).toEqual({
      left: { shown: 4, seen: 3 },
      right: { shown: 0, seen: 0 },
      falseAlarms: 1,
    });
  });

  it('flags presses without a symbol', () => {
    expect(sessionInconsistencies(l3({ catchShownLeft: 2, catchHitLeft: 1, catchFalseAlarms: 3 }))).toEqual([
      'presses-without-symbol',
    ]);
    expect(sessionInconsistencies(l3({ catchShownLeft: 2, catchHitLeft: 2, catchFalseAlarms: 1 }))).toEqual(
      [],
    );
  });

  it('flags a missed eye only when the session’s own results needed both eyes', () => {
    const missedLeft = { catchShownLeft: 3, catchHitLeft: 0, catchShownRight: 3, catchHitRight: 3 };
    expect(sessionInconsistencies(l3({ ...missedLeft, catchRate: 0.9 }))).toEqual(['left-missed']);
    // Low catch rate: the result itself says the left eye was not taking part — consistent.
    expect(sessionInconsistencies(l3({ ...missedLeft, catchRate: 0.2 }))).toEqual([]);
    expect(bothEyesReported(makeSession({ moduleId: 'brock', metrics: { beadsConfirmed: 2 } }))).toBe(true);
    expect(bothEyesReported(makeSession({ moduleId: 'video', metrics: {} }))).toBe(false);
  });

  it('summarizes per eye across sessions', () => {
    const sum = summarizeConsistency([
      l3({ catchShownLeft: 2, catchHitLeft: 2, catchShownRight: 2, catchHitRight: 1, catchRate: 0.8 }),
      l3({ catchShownLeft: 2, catchHitLeft: 0, catchShownRight: 2, catchHitRight: 2, catchRate: 0.8 }),
      makeSession({ status: 'in-progress', metrics: { catchShownLeft: 9 } }),
    ]);
    expect(sum).toMatchObject({ sessions: 2, left: { shown: 4, seen: 2 }, right: { shown: 4, seen: 3 } });
    expect(sum.flagged).toHaveLength(1);
  });
});

describe('problem reports', () => {
  const entry = (i: number): ErrorLogEntry => ({
    id: `e${i}`,
    at: `2026-10-0${(i % 9) + 1}T10:00:00.000Z`,
    kind: 'error',
    message: `TypeError: boom ${i}`,
    stack: 'at a (x.js:1)\nat b (y.js:2)',
    route: '/train/l2',
    appVersion: '0.4.0',
  });

  it('contains version, browser and the latest errors, newest first, and nothing else', () => {
    const r = buildErrorReport([entry(1), entry(5)], {
      userAgent: 'TestBrowser/1',
      language: 'en',
      note: 'ball stuck',
    });
    expect(r.title).toContain('TypeError: boom 5');
    expect(r.body).toContain('**Browser:** TestBrowser/1');
    expect(r.body).toContain('ball stuck');
    expect(r.body.indexOf('boom 5')).toBeLessThan(r.body.indexOf('boom 1'));
  });

  it('builds a GitHub new-issue link within URL limits', () => {
    const r = buildErrorReport(
      Array.from({ length: 8 }, (_, i) => ({ ...entry(i), stack: 'x'.repeat(3000) })),
      { userAgent: 'B', language: 'en' },
    );
    const url = issueUrl(r);
    expect(url.startsWith(`${ISSUES_URL}?`)).toBe(true);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(new URL(url).searchParams.get('labels')).toBe('bug,from-app');
  });
});

describe('quick start', () => {
  it('estimates pixels per inch from the screen size and its diagonal', () => {
    expect(estimatePpi(1920, 1080, 24)).toBeCloseTo(91.8, 1);
    expect(estimatePpi(1440, 900, 14)).toBeCloseTo(121.3, 1);
    expect(estimatePpi(100, 100, 50)).toBe(50); // clamped to the plausible range
  });

  it('a quick calibration does not unlock stages that need exact Δ / arcsec conversion', () => {
    const settings = {
      ...defaultSettings(),
      activeCalibrationId: 'cal',
      disclaimerAcceptedVersion: 2,
      clinicianAgreement: true,
    };
    const ctx = {
      settings,
      sessions: [],
      checks: [],
      disclaimerVersion: 2,
      calibrationQuality: 'quick' as const,
    };
    expect(evaluateGate('l1', ctx).reasons).toEqual([]);
    expect(evaluateGate('l4', ctx).reasons).toContain('needs-full-calibration');
    expect(evaluateGate('l5', ctx).reasons).toContain('needs-full-calibration');
    expect(evaluateGate('l4', { ...ctx, calibrationQuality: 'full' }).reasons).not.toContain(
      'needs-full-calibration',
    );
  });
});
