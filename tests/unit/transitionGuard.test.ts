import { describe, expect, it } from 'vitest';
import { MIN_TRANSITION_INTERVAL_MS, TransitionGuard } from '../../src/engine/transitionGuard';

describe('TransitionGuard', () => {
  it('allows transitions spaced at least 334 ms apart', () => {
    const g = new TransitionGuard();
    expect(g.request(0)).toBe(true);
    expect(g.request(MIN_TRANSITION_INTERVAL_MS)).toBe(true);
    expect(g.request(MIN_TRANSITION_INTERVAL_MS * 2)).toBe(true);
  });

  it('refuses transitions closer than 334 ms', () => {
    const g = new TransitionGuard();
    expect(g.request(0)).toBe(true);
    expect(g.request(100)).toBe(false);
    expect(g.request(333)).toBe(false);
    expect(g.request(334)).toBe(true);
  });

  it('never allows more than 3 transitions in any sliding one-second window', () => {
    // Use a short min interval so the per-second cap is the binding constraint.
    const g = new TransitionGuard(100, 3);
    expect(g.request(0)).toBe(true);
    expect(g.request(100)).toBe(true);
    expect(g.request(200)).toBe(true);
    expect(g.request(300)).toBe(false);
    expect(g.waitMs(300)).toBe(700);
    expect(g.request(999)).toBe(false);
    expect(g.request(1000)).toBe(true); // t=0 has left the window
  });

  it('with default settings 334 ms spacing never exceeds the cap', () => {
    const g = new TransitionGuard();
    let allowed = 0;
    for (let t = 0; t <= 2004; t += 334) if (g.request(t)) allowed++;
    expect(allowed).toBe(7);
  });

  it('tracks keys independently', () => {
    const g = new TransitionGuard();
    expect(g.request(0, 'a')).toBe(true);
    expect(g.request(0, 'b')).toBe(true);
  });

  it('reports the wait time until the next allowed transition', () => {
    const g = new TransitionGuard();
    g.request(0);
    expect(g.waitMs(100)).toBe(234);
    expect(g.waitMs(400)).toBe(0);
  });
});
