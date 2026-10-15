import { describe, expect, it } from 'vitest';
import { dotDensity, generateRds, snapDisparity, type Rect } from '../../src/engine/rds';
import { TransitionGuard } from '../../src/engine/transitionGuard';
import { prismDioptersToPx } from '../../src/engine/units';
import { VERGENCE_CEILING, VergenceRamp, summarizeRounds } from '../../src/engine/vergence';
import { IDENTITY_TRANSFORM } from '../../src/engine/affine';
import { DEFAULT_CHANNEL_MAP } from '../../src/engine/renderer/types';
import { seededRandom } from '../../src/modules/common';
import { L3Instance, assessL3 } from '../../src/modules/l3';
import { L4Instance, assessL4 } from '../../src/modules/l4';
import { L5Instance, assessL5 } from '../../src/modules/l5';
import { assessVideo, eyeVisibility, maskValue } from '../../src/modules/video';
import type { ModuleRuntimeContext } from '../../src/modules/types';
import { firstAndLatest, minutesPerDay, summarize } from '../../src/dashboard/trends';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

const W = 1000;
const H = 600;

function ctx(over: Partial<ModuleRuntimeContext> = {}): ModuleRuntimeContext {
  return {
    calibration: makeCalibration(),
    geometry: { distanceM: 0.6, ppi: 96 },
    intensityValue: 0.5,
    gameDifficulty: 1,
    guard: new TransitionGuard(),
    reducedMotion: false,
    width: W,
    height: H,
    dpr: 1,
    config: {},
    emit: () => {},
    random: seededRandom(3),
    ...over,
  };
}

function run(m: { update(dt: number, now: number): void }, ms: number, t0 = 0): number {
  let t = t0;
  while (t < t0 + ms) {
    t += 16;
    m.update(16, t);
  }
  return t;
}

const baseRender = {
  transforms: { left: { ...IDENTITY_TRANSFORM }, right: { ...IDENTITY_TRANSFORM } },
  channels: DEFAULT_CHANNEL_MAP,
  contrast: { left: 1, right: 1 },
  backgroundGray: 0,
};

describe('random-dot stereogram', () => {
  const field: Rect = { x: 0, y: 0, w: 400, h: 400 };
  const target: Rect = { x: 150, y: 150, w: 100, h: 100 };
  const img = generateRds({
    field,
    target,
    dotSize: 4,
    density: 0.45,
    disparityPx: 6,
    random: seededRandom(11),
  });

  it('has no monocular cue: each eye alone has the same dot density inside and outside the target', () => {
    const outside: Rect = { x: 20, y: 20, w: 100, h: 100 };
    for (const eye of [img.left, img.right]) {
      const inT = dotDensity(eye, target, 4);
      const out = dotDensity(eye, outside, 4);
      expect(Math.abs(inT - out) / out).toBeLessThan(0.2);
    }
  });

  it('shifts only the target region between the eyes (crossed disparity)', () => {
    const key = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    const right = new Set(img.right.map(key));
    const far: Rect = { x: 0, y: 0, w: 120, h: 400 };
    const farLeftDots = img.left.filter((p) => p.x + 2 < far.x + far.w);
    // Background far from the target is identical in both eyes.
    expect(farLeftDots.every((p) => right.has(key(p)))).toBe(true);
    // Target dots appear 6 px to the left in the right eye.
    const targetDots = img.left.filter(
      (p) =>
        p.x + 2 >= target.x + 10 &&
        p.x + 2 < target.x + target.w - 10 &&
        p.y + 2 >= target.y &&
        p.y + 2 < target.y + target.h,
    );
    expect(targetDots.length).toBeGreaterThan(50);
    expect(targetDots.every((p) => right.has(key({ x: p.x - 6, y: p.y })))).toBe(true);
  });

  it('snaps disparity to whole device pixels and never below one', () => {
    expect(snapDisparity(0.2, 1)).toBe(1);
    expect(snapDisparity(0.2, 2)).toBe(0.5);
    expect(snapDisparity(3.4, 1)).toBe(3);
    expect(snapDisparity(-2.6, 1)).toBe(-3);
  });
});

describe('vergence ramp', () => {
  const cfg = { capDelta: 8, rampUpPerSec: 1, rampDownPerSec: 2, restMs: 1000, holdMs: 1000 };

  it('rests, ramps up at the set rate, records break and recovery, then alternates direction', () => {
    const r = new VergenceRamp(cfg);
    r.update(1000); // rest done
    expect(r.phase).toBe('ramp-up');
    r.update(3000); // +3Δ
    expect(r.demand).toBeCloseTo(3, 5);
    expect(r.report()).toBe('break');
    expect(r.phase).toBe('ramp-down');
    r.update(500); // −1Δ
    expect(r.report()).toBe('recovery');
    expect(r.rounds[0]).toMatchObject({ direction: 'BO', breakDelta: 3, recoveryDelta: 2 });
    expect(r.direction).toBe('BI');
    expect(r.phase).toBe('rest');
  });

  it('never exceeds the cap or the ceilings; divergence is capped at 6Δ', () => {
    const r = new VergenceRamp({ ...cfg, capDelta: 20 });
    expect(r.cap).toBe(VERGENCE_CEILING.BO);
    r.update(1000);
    for (let i = 0; i < 400 && r.rounds.length < 1; i++) r.update(100);
    expect(r.rounds[0]?.maxDelta).toBeLessThanOrEqual(12);
    expect(r.rounds[0]?.breakDelta).toBeNull(); // no break: reached the cap, held, came back
    // Now base-in.
    expect(r.direction).toBe('BI');
    expect(r.cap).toBe(6);
    r.update(1000);
    for (let i = 0; i < 400 && r.rounds.length < 2; i++) r.update(100);
    expect(r.rounds[1]?.direction).toBe('BI');
    expect(r.rounds[1]?.maxDelta).toBeLessThanOrEqual(6);
  });

  it('ignores reports while resting and summarizes rounds per direction', () => {
    const r = new VergenceRamp(cfg);
    expect(r.report()).toBeNull();
    r.update(1000);
    r.update(4000);
    r.report();
    r.update(1000);
    r.report();
    const s = summarizeRounds(r.rounds);
    expect(s['rounds']).toBe(1);
    expect(s['meanBreakBO']).toBe(4);
    expect(s['meanRecoveryBO']).toBe(2);
    expect(s['noBreakBO']).toBe(0);
  });
});

describe('L4 Stretch', () => {
  it('moves the two eyes apart horizontally only, by the full demand in total', () => {
    const m = new L4Instance(ctx({ intensityValue: 6 }));
    m.start(0);
    run(m, 3000 + 5000); // rest then ~2Δ of ramp at 0.4Δ/s
    const demand = m.ramp.demand;
    expect(demand).toBeGreaterThan(1.5);
    const o = m.renderOverrides(baseRender);
    const px = prismDioptersToPx(demand, { distanceM: 0.6, ppi: 96 });
    expect(o.transforms.left.dx - o.transforms.right.dx).toBeCloseTo(px, 3);
    expect(o.transforms.left.dy).toBe(0);
    expect(o.transforms.right.dy).toBe(0);
    m.input({ type: 'action' });
    expect(m.metrics()['rounds']).toBe(0); // break recorded, round not finished yet
    expect(m.hud().promptKey).toBe('modules.l4.prompt.stretch');
  });

  it('rates sessions: early breaks are poor, reaching the cap is good', () => {
    expect(assessL4({ rounds: 4, meanBreakBO: 0.5, maxDemandBO: 0.6 }, 3)).toBe('poor');
    expect(assessL4({ rounds: 4, meanBreakBO: 5, maxDemandBO: 6 }, 3)).toBe('good');
    expect(assessL4({ rounds: 4, noBreakBO: 1, maxDemandBO: 6 }, 3)).toBe('good');
    expect(assessL4({ rounds: 1 }, 3)).toBe('ok');
  });
});

describe('L3 catch', () => {
  it('catches a left-eye star with the right-eye basket underneath', () => {
    const m = new L3Instance(ctx({ random: () => 0.5 }));
    m.start(0);
    run(m, 9000);
    expect(m.metrics()['starsCaught']).toBeGreaterThan(0);
    expect(m.metrics()['starsMissed']).toBe(0);
  });

  it('misses when the basket is elsewhere', () => {
    const m = new L3Instance(ctx({ random: () => 0.5 }));
    m.start(0);
    m.input({ type: 'pointer', x: 0, y: 0, down: true }); // far left
    run(m, 9000);
    expect(m.metrics()['starsMissed']).toBeGreaterThan(0);
    expect(m.metrics()['starsCaught']).toBe(0);
  });

  it('rates catch rate', () => {
    expect(assessL3({ starsCaught: 8, starsMissed: 2 }, 4)).toBe('good');
    expect(assessL3({ starsCaught: 2, starsMissed: 8 }, 4)).toBe('poor');
    expect(assessL3({ starsCaught: 1, starsMissed: 1 }, 4)).toBe('ok');
  });
});

describe('L5 Pop-Out', () => {
  function answerCorrect(m: L5Instance) {
    const side = m.currentSide;
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[side];
    m.input({ type: 'direction', dx: dir[0]!, dy: dir[1]! });
  }

  it('makes the disparity smaller after two correct answers (2-down/1-up) and never below one pixel', () => {
    const m = new L5Instance(ctx({ intensityValue: 800 }));
    m.start(0);
    let t = run(m, 700);
    expect(m.isShowing).toBe(true);
    const first = m.currentArcsec;
    for (let i = 0; i < 2; i++) {
      answerCorrect(m);
      t = run(m, 1400, t);
      expect(m.isShowing).toBe(true);
    }
    expect(m.currentArcsec).toBeLessThan(first);
    expect(m.metrics()['correctTrials']).toBe(2);
    // Keep answering correctly: the staircase floors at one device pixel (~91″ here).
    for (let i = 0; i < 30; i++) {
      answerCorrect(m);
      t = run(m, 1400, t);
    }
    expect(m.currentArcsec).toBeGreaterThanOrEqual(90);
  });

  it('counts "cannot tell" as not seen and rates performance', () => {
    const m = new L5Instance(ctx({ intensityValue: 800 }));
    m.start(0);
    run(m, 700);
    m.input({ type: 'action' });
    expect(m.metrics()['cantTell']).toBe(1);
    expect(m.metrics()['correctTrials']).toBe(0);
    expect(assessL5({ trials: 12, percentCorrect: 80 }, 3)).toBe('good');
    expect(assessL5({ trials: 12, percentCorrect: 30 }, 3)).toBe('poor');
    expect(assessL5({ trials: 4, percentCorrect: 100 }, 3)).toBe('ok');
  });
});

describe('dichoptic video', () => {
  it('masks are complementary: every point stays visible to at least one eye', () => {
    for (const s of [0, 0.3, 0.7, 0.9]) {
      for (let m = 0; m <= 1; m += 0.1) {
        const v = eyeVisibility(m, s);
        expect(Math.max(v.left, v.right)).toBeGreaterThanOrEqual(1 - s * 0.6 - 1e-9);
        expect(v.left).toBeGreaterThanOrEqual(0);
        expect(v.right).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('mask values stay in range and change slowly over time', () => {
    for (let x = 0; x < 32; x += 5) {
      const a = maskValue(x, 3, 10, 1);
      const b = maskValue(x, 3, 10.1, 1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(Math.abs(a - b)).toBeLessThan(0.02);
    }
  });

  it('rates watching time', () => {
    expect(assessVideo({ watchedSeconds: 540 }, 10)).toBe('good');
    expect(assessVideo({ watchedSeconds: 60 }, 10)).toBe('poor');
  });
});

describe('report summaries', () => {
  it('summarizes adherence, symptoms and safety events in a date range', () => {
    const s1 = makeSession({ day: '2026-10-01', moduleId: 'l1', actualMinutes: 4, status: 'completed' });
    const s2 = makeSession({ day: '2026-10-02', moduleId: 'l2', actualMinutes: 5, status: 'stopped' });
    const s3 = makeSession({ day: '2026-09-20', moduleId: 'l1', actualMinutes: 4, status: 'completed' });
    const checks = [
      makeCheck({ at: '2026-10-01T10:00:00Z', diplopia: 2 }),
      makeCheck({ at: '2026-10-02T10:00:00Z', headache: 2 }),
      makeCheck({ at: '2026-10-02T09:00:00Z', phase: 'pre', diplopia: 4 }),
    ];
    const events = [
      { id: 'e1', at: '2026-10-02T10:00:00Z', type: 'stop' as const, sessionId: null, details: '' },
      { id: 'e2', at: '2026-09-01T10:00:00Z', type: 'red-flag' as const, sessionId: null, details: '' },
    ];
    const r = summarize([s1, s2, s3], checks, events, '2026-10-01', '2026-10-07');
    expect(r).toMatchObject({
      sessions: 2,
      completed: 1,
      stopped: 1,
      minutes: 9,
      daysTrained: 2,
      daysInRange: 7,
      diplopiaSessions: 1,
      headacheSessions: 1,
      stops: 1,
      redFlags: 0,
    });
    expect(r.perModule.map((m) => m.moduleId).sort()).toEqual(['l1', 'l2']);
  });

  it('builds per-day minutes and first/latest values', () => {
    const sessions = [
      makeSession({
        day: '2026-10-05',
        startedAt: '2026-10-05T08:00:00Z',
        actualMinutes: 4,
        intensityValue: 0.5,
      }),
      makeSession({
        day: '2026-10-06',
        startedAt: '2026-10-06T08:00:00Z',
        actualMinutes: 4,
        intensityValue: 0.55,
      }),
    ];
    const days = minutesPerDay(sessions, 3, new Date('2026-10-06T12:00:00'));
    expect(days.map((d) => d.value)).toEqual([0, 4, 4]);
    const fl = firstAndLatest(sessions, 'l1', (s) => s.intensityValue * 100);
    expect(fl?.first).toBeCloseTo(50);
    expect(fl?.latest).toBeCloseTo(55);
    expect(fl?.n).toBe(2);
  });
});
