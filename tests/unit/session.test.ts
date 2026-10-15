import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../../src/data/db';
import { defaultSettings } from '../../src/data/schema';
import { initialProgress } from '../../src/modules/adaptive';
import { getModule } from '../../src/modules/registry';
import {
  applyPostCheckRules,
  createSessionRecord,
  finalizeSession,
  recordSafetyEvent,
  recoverInProgressSessions,
  saveSession,
} from '../../src/safety/session';
import type { RedFlagReport } from '../../src/safety/symptomRules';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

const NO_FLAGS: RedFlagReport = {
  suddenDeviationIncrease: false,
  newDoubleVision: false,
  ptosis: false,
  unequalPupils: false,
  severeHeadache: false,
  otherNeurological: false,
};

beforeEach(() => {
  resetDbForTests();
  vi.useRealTimers();
});

describe('session records', () => {
  it('creates an in-progress record with the current difficulty, distance and a sanitised note', () => {
    const calibration = makeCalibration({ viewingDistanceCm: 55 });
    const progress = { ...initialProgress(getModule('l1'), calibration, 'low'), gameDifficulty: 3 };
    const rec = createSessionRecord({
      moduleId: 'l1',
      calibration,
      rendererId: 'anaglyph-canvas2d',
      plannedMinutes: 8,
      progress,
      metric: 'dominantContrastRatio',
      postureNote: 'chin down\u0007',
      preCheckId: 'chk_1',
    });
    expect(rec).toMatchObject({
      status: 'in-progress',
      calibrationId: calibration.id,
      plannedMinutes: 8,
      gameDifficulty: 3,
      viewingDistanceCm: 55,
      postureNote: 'chin down',
      preCheckId: 'chk_1',
      endedAt: null,
    });
    expect(rec.events.map((e) => e.type)).toEqual(['start']);
  });

  it('finalising records minutes, status, metrics and a closing event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T10:04:30.000Z'));
    const s = makeSession({
      startedAt: '2026-10-01T10:00:00.000Z',
      status: 'in-progress',
      metrics: { a: 1 },
    });
    const done = finalizeSession(s, 'completed', { b: 2 });
    expect(done.actualMinutes).toBe(4.5);
    expect(done.metrics).toEqual({ a: 1, b: 2 });
    expect(done.events.at(-1)?.type).toBe('complete');
    expect(finalizeSession(s, 'stopped', {}).events.at(-1)?.type).toBe('stop');
  });

  it('recovers sessions left in progress by a crash, ending them at the last heartbeat', async () => {
    const heartbeat = new Date('2026-10-01T10:03:00.000Z').getTime();
    await saveSession(
      makeSession({
        id: 'ses_crash',
        status: 'in-progress',
        startedAt: '2026-10-01T10:00:00.000Z',
        endedAt: null,
        metrics: { lastHeartbeatMs: heartbeat },
      }),
    );
    await saveSession(makeSession({ id: 'ses_ok', status: 'completed' }));
    expect(await recoverInProgressSessions()).toBe(1);
    const rec = await getDb().sessions.get('ses_crash');
    expect(rec).toMatchObject({ status: 'recovered', actualMinutes: 3, endedAt: '2026-10-01T10:03:00.000Z' });
    expect(rec?.events.at(-1)?.type).toBe('recovered');
    expect((await getDb().sessions.get('ses_ok'))?.status).toBe('completed');
    expect(await recoverInProgressSessions()).toBe(0);
  });

  it('records safety events with sanitised, length-limited details', async () => {
    const ev = await recordSafetyEvent('stop', `pressed\u0000 ${'x'.repeat(600)}`, 'ses_1');
    expect(ev.details.startsWith('pressed x')).toBe(true);
    expect(ev.details.length).toBe(500);
    expect(await getDb().safetyEvents.count()).toBe(1);
  });
});

describe('post-session safety rules', () => {
  const def = getModule('l1');
  const calibration = makeCalibration();
  const settings = { progressionLock: defaultSettings().progressionLock, clinicianAgreement: false };
  const progress = { ...initialProgress(def, calibration, 'medium'), gameDifficulty: 3 };

  it('a comfortable check changes nothing', () => {
    const check = makeCheck();
    const out = applyPostCheckRules({
      def,
      check,
      redFlags: NO_FLAGS,
      progress,
      calibration,
      settings,
      postChecksNewestFirst: [check],
    });
    expect(out).toEqual({ progress, steppedBack: false, progressionLocked: false, trainingLocked: false });
  });

  it('any discomfort steps visual difficulty back at once', () => {
    const check = makeCheck({ headache: 2 });
    const out = applyPostCheckRules({
      def,
      check,
      redFlags: NO_FLAGS,
      progress,
      calibration,
      settings,
      postChecksNewestFirst: [check],
    });
    expect(out.steppedBack).toBe(true);
    expect(out.progress.intensityValue).toBeLessThan(progress.intensityValue);
    expect(out.progress.gameDifficulty).toBe(progress.gameDifficulty);
  });

  it('frequent double vision also steps game difficulty back', () => {
    const check = makeCheck({ diplopia: 3 });
    const out = applyPostCheckRules({
      def,
      check,
      redFlags: NO_FLAGS,
      progress,
      calibration,
      settings,
      postChecksNewestFirst: [check],
    });
    expect(out.progress.gameDifficulty).toBe(progress.gameDifficulty - 1);
  });

  it('double vision in two consecutive sessions locks progression', () => {
    const now = makeCheck({ diplopia: 2, at: '2026-10-02T10:00:00.000Z' });
    const before = makeCheck({ diplopia: 2, at: '2026-10-01T10:00:00.000Z' });
    const out = applyPostCheckRules({
      def,
      check: now,
      redFlags: NO_FLAGS,
      progress,
      calibration,
      settings,
      postChecksNewestFirst: [now, before],
    });
    expect(out.progressionLocked).toBe(true);
  });

  it('a red flag locks training', () => {
    const check = makeCheck();
    const out = applyPostCheckRules({
      def,
      check,
      redFlags: { ...NO_FLAGS, ptosis: true },
      progress,
      calibration,
      settings,
      postChecksNewestFirst: [check],
    });
    expect(out.trainingLocked).toBe(true);
  });
});
