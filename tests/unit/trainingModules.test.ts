import { describe, expect, it } from 'vitest';
import { TransitionGuard } from '../../src/engine/transitionGuard';
import { Steerer, distance, seededRandom } from '../../src/modules/common';
import { L1Instance, assessL1 } from '../../src/modules/l1';
import { CONFIRM_RADIUS_FACTOR, L2Instance, assessL2 } from '../../src/modules/l2';
import type { ModuleRuntimeContext } from '../../src/modules/types';
import { makeCalibration } from '../fixtures/factories';

const W = 1000;
const H = 600;
const area = { width: W, height: H };

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
    emit: () => {},
    random: seededRandom(7),
    dpr: 1,
    config: {},
    ...over,
  };
}

/** Advance a module by `ms` in 16 ms frames, starting at `t0`. Returns the end time. */
function run(m: { update(dt: number, now: number): void }, ms: number, t0 = 0): number {
  let t = t0;
  const end = t0 + ms;
  while (t < end) {
    t += 16;
    m.update(16, t);
  }
  return t;
}

describe('Steerer (shared movement)', () => {
  it('moves at constant speed while a direction is held and stops when released', () => {
    const s = new Steerer({ x: 500, y: 300 }, 200, 10);
    s.setDirection(1, 0);
    for (let i = 0; i < 25; i++) s.update(area, 20); // 0.5 s
    expect(s.pos.x).toBeCloseTo(600, 0);
    s.setDirection(0, 0);
    for (let i = 0; i < 25; i++) s.update(area, 20);
    expect(s.pos.x).toBeCloseTo(600, 0); // no sliding after release
  });

  it('a single tap sets a target that persists until reached', () => {
    const s = new Steerer({ x: 400, y: 300 }, 200, 10);
    s.setTarget(area, { x: 520, y: 260 });
    // No pointer-up handling can cancel it: just keep updating.
    for (let i = 0; i < 100; i++) s.update(area, 16);
    expect(distance(s.pos, { x: 520, y: 260 })).toBeLessThan(0.01);
    expect(s.hasTarget).toBe(false);
  });

  it('a held direction cancels a pending tap target', () => {
    const s = new Steerer({ x: 400, y: 300 }, 200, 10);
    s.setTarget(area, { x: 600, y: 300 });
    s.setDirection(0, -1);
    s.update(area, 100);
    expect(s.hasTarget).toBe(false);
    expect(s.pos.x).toBe(400);
    expect(s.pos.y).toBeLessThan(300);
  });

  it('diagonals are not faster and positions stay inside the stimulus area', () => {
    const s = new Steerer({ x: 500, y: 300 }, 100, 10);
    s.setDirection(1, 1);
    s.update(area, 1000);
    expect(distance(s.pos, { x: 500, y: 300 })).toBeCloseTo(100, 0);
    s.setDirection(1, 0);
    s.update(area, 100000);
    expect(s.pos.x).toBeLessThanOrEqual(W / 2 + W * 0.3 - 10);
  });
});

describe('L2 "Line Them Up"', () => {
  it('a single click on the ring moves the ball there and completes a round', () => {
    const m = new L2Instance(ctx());
    m.start(0);
    const ring = m.ringPosition;
    m.input({ type: 'pointer', x: ring.x, y: ring.y, down: true });
    run(m, 3000);
    expect(m.metrics()['alignments']).toBe(1);
    expect(m.hud().score).toBe(10);
  });

  it('holding an arrow key steers the ball into the ring and the hold progress rises', () => {
    const m = new L2Instance(ctx());
    m.start(0);
    // Ball starts 60 px below the ring.
    m.input({ type: 'direction', dx: 0, dy: -1 });
    let t = 0;
    while (distance(m.ballPosition, m.ringPosition) > 2 && t < 2000) t = run(m, 16, t);
    m.input({ type: 'direction', dx: 0, dy: 0 });
    t = run(m, 400, t);
    expect(m.hud().roundProgress).toBeGreaterThan(0.3);
    run(m, 1000, t);
    expect(m.metrics()['autoAlignments']).toBe(1);
  });

  it('accepts a ball that is visibly inside the ring, not only its exact centre', () => {
    const m = new L2Instance(ctx());
    expect(m.alignTolerancePx).toBeGreaterThan(25); // was 17.6 px before the fix
    m.start(0);
    const ring = m.ringPosition;
    m.input({ type: 'pointer', x: ring.x + 24, y: ring.y, down: true });
    run(m, 3000);
    expect(m.metrics()['autoAlignments']).toBe(1);
  });

  it('Space confirms a perceived alignment within the confirm radius and records the residual', () => {
    const m = new L2Instance(ctx());
    m.start(0);
    const ring = m.ringPosition;
    m.input({ type: 'pointer', x: ring.x - 60, y: ring.y, down: true });
    const t = run(m, 1500);
    expect(distance(m.ballPosition, ring)).toBeLessThanOrEqual(44 * CONFIRM_RADIUS_FACTOR);
    m.input({ type: 'action' });
    run(m, 16, t);
    const metrics = m.metrics();
    expect(metrics['confirmedAlignments']).toBe(1);
    expect(metrics['meanResidualDxPx']).toBeCloseTo(-60, 0);
    // 60 px at 60 cm and 96 PPI is about 2.6 prism diopters.
    expect(metrics['meanResidualDelta']).toBeCloseTo(2.65, 1);
  });

  it('Space far from the ring does not count and tells the user why', () => {
    const m = new L2Instance(ctx());
    m.start(0);
    const ring = m.ringPosition;
    m.input({ type: 'pointer', x: ring.x - 250, y: ring.y, down: true });
    const t = run(m, 2500);
    m.input({ type: 'action' });
    run(m, 32, t);
    expect(m.metrics()['alignments']).toBe(0);
    expect(m.metrics()['farConfirms']).toBe(1);
    expect(m.hud().promptKey).toBe('modules.l2.prompt.tooFar');
  });

  it('keeps working round after round as the ring moves', () => {
    const m = new L2Instance(ctx());
    m.start(0);
    let t = 0;
    for (let round = 0; round < 5; round++) {
      t = run(m, 8000, t); // let the ring finish gliding (up to ~550 px at 90 px/s)
      const ring = m.ringPosition;
      m.input({ type: 'pointer', x: ring.x, y: ring.y, down: true });
      t = run(m, 3000, t);
    }
    expect(m.metrics()['alignments']).toBe(5);
  });

  it('rates performance from alignments per minute', () => {
    expect(assessL2({ alignments: 0 }, 5)).toBe('poor');
    expect(assessL2({ alignments: 5 }, 5)).toBe('ok');
    expect(assessL2({ alignments: 10 }, 5)).toBe('good');
  });
});

describe('L1 "Both Eyes On"', () => {
  it('a single click on the cage flies the bird in and time in cage accumulates', () => {
    const m = new L1Instance(ctx());
    m.start(0);
    const cage = m.cagePosition;
    expect(distance(m.birdPosition, cage)).toBeGreaterThan(60); // starts outside
    m.input({ type: 'pointer', x: cage.x, y: cage.y, down: true });
    run(m, 3000);
    expect(m.metrics()['timeInCageFraction']).toBeGreaterThan(0.3);
    expect(m.hud().score).toBeGreaterThan(0);
  });

  it('held arrow keys move the bird', () => {
    const m = new L1Instance(ctx());
    m.start(0);
    const before = m.birdPosition;
    m.input({ type: 'direction', dx: 1, dy: 0 });
    run(m, 500);
    expect(m.birdPosition.x - before.x).toBeGreaterThan(80);
  });

  it('counts chick hits and false alarms separately', () => {
    const m = new L1Instance(ctx({ random: () => 0 }));
    m.start(0);
    m.input({ type: 'action' }); // no chick yet
    const t = run(m, 8100); // first chick appears at 8 s with random() = 0
    expect(m.isProbeVisible).toBe(true);
    m.input({ type: 'action' });
    m.input({ type: 'action' }); // second press in the same window is ignored
    run(m, 16, t);
    const metrics = m.metrics();
    expect(metrics['probesHit']).toBe(1);
    expect(metrics['probeFalseAlarms']).toBe(1);
  });

  it('rates performance from time in cage and chick hit rate', () => {
    expect(assessL1({ timeInCageFraction: 0.1, probesShown: 3, probeHitRate: 1 }, 4)).toBe('poor');
    expect(assessL1({ timeInCageFraction: 0.7, probesShown: 3, probeHitRate: 0.67 }, 4)).toBe('good');
    expect(assessL1({ timeInCageFraction: 0.7, probesShown: 4, probeHitRate: 0.25 }, 4)).toBe('ok');
    expect(assessL1({ timeInCageFraction: 0.6, probesShown: 1, probeHitRate: 0 }, 4)).toBe('good');
  });
});
