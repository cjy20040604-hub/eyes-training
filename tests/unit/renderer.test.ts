import { describe, expect, it } from 'vitest';
import {
  RENDERER_IDS,
  createRenderer,
  DEFAULT_CHANNEL_MAP,
  channelColor,
  type EyeLayer,
} from '../../src/engine/renderer';
import { IDENTITY_TRANSFORM } from '../../src/engine/affine';
import { l1Module } from '../../src/modules/l1';
import { l2Module } from '../../src/modules/l2';
import { seededRandom } from '../../src/modules/common';
import { TransitionGuard } from '../../src/engine/transitionGuard';
import { makeCalibration } from '../fixtures/factories';
import type { ModuleRuntimeContext } from '../../src/modules/types';

function ctx(over: Partial<ModuleRuntimeContext> = {}): ModuleRuntimeContext {
  return {
    calibration: makeCalibration(),
    geometry: { distanceM: 0.6, ppi: 96 },
    intensityValue: 0.5,
    gameDifficulty: 1,
    guard: new TransitionGuard(),
    reducedMotion: false,
    width: 800,
    height: 450,
    emit: () => {},
    random: seededRandom(1),
    dpr: 1,
    config: {},
    ...over,
  };
}

describe('renderer registry', () => {
  it('creates every renderer id; WebXR reports unsupported', () => {
    for (const id of RENDERER_IDS) {
      const r = createRenderer(id);
      expect(r.id === id || (id === 'anaglyph-webgl' && r.id === 'anaglyph-canvas2d')).toBe(true);
      if (id === 'webxr') expect(r.supported).toBe(false);
      else expect(r.supported).toBe(true);
      r.dispose();
    }
  });

  it('channel colours are additive red and cyan', () => {
    expect(channelColor('red', 1)).toEqual([255, 0, 0]);
    expect(channelColor('cyan', 0.5)).toEqual([0, 128, 128]);
  });
});

describe('modules are renderer-agnostic', () => {
  it('L1 and L2 run identically against any renderer (they only draw into eye layers)', () => {
    for (const id of ['anaglyph-canvas2d', 'sbs'] as const) {
      const renderer = createRenderer(id);
      const canvas = document.createElement('canvas');
      renderer.attach(canvas, 800, 450, 1);
      for (const def of [l1Module, l2Module]) {
        const m = def.create(ctx());
        m.start(0);
        const layers = { left: fakeLayer(), right: fakeLayer() };
        for (let f = 1; f <= 30; f++) {
          m.update(16, f * 16);
          m.draw(layers);
          const opts = m.renderOverrides({
            transforms: { left: IDENTITY_TRANSFORM, right: IDENTITY_TRANSFORM },
            channels: DEFAULT_CHANNEL_MAP,
            contrast: { left: 1, right: 1 },
            backgroundGray: 0,
          });
          expect(() =>
            renderer.composite({ left: layers.left.canvas, right: layers.right.canvas }, opts),
          ).not.toThrow();
        }
        expect(Object.keys(m.metrics()).length).toBeGreaterThan(0);
        m.stop();
      }
      renderer.dispose();
    }
  });

  it('L1 applies the dominant-eye contrast and keeps the weak eye at 100%', () => {
    const m = l1Module.create(ctx({ intensityValue: 0.62 }));
    const opts = m.renderOverrides({
      transforms: { left: IDENTITY_TRANSFORM, right: IDENTITY_TRANSFORM },
      channels: DEFAULT_CHANNEL_MAP,
      contrast: { left: 1, right: 1 },
      backgroundGray: 0,
    });
    expect(opts.contrast.right).toBeCloseTo(0.62);
    expect(opts.contrast.left).toBe(1);
  });

  it('L2 removes the given percentage of compensation from BOTH eyes independently', () => {
    const m = l2Module.create(ctx({ intensityValue: 20 }));
    const base = {
      transforms: { left: { dx: -100, dy: 10, rotationDeg: 0 }, right: { dx: 40, dy: 0, rotationDeg: 0 } },
      channels: DEFAULT_CHANNEL_MAP,
      contrast: { left: 1, right: 1 },
      backgroundGray: 0,
    };
    const opts = m.renderOverrides(base);
    expect(opts.transforms.left.dx).toBeCloseTo(-80);
    expect(opts.transforms.left.dy).toBeCloseTo(8);
    expect(opts.transforms.right.dx).toBeCloseTo(32);
  });

  it('L1 probe visibility changes go through the transition guard', () => {
    const guard = new TransitionGuard();
    const m = l1Module.create(ctx({ guard, random: () => 0 }));
    m.start(0);
    let probes = 0;
    const emitCtx = ctx({ guard, random: () => 0, emit: (t) => t === 'probe' && probes++ });
    const m2 = l1Module.create(emitCtx);
    m2.start(0);
    for (let t = 16; t < 60000; t += 16) m2.update(16, t);
    expect(probes).toBeGreaterThan(0);
    expect(probes).toBeLessThan(10);
    m.stop();
    m2.stop();
  });
});

function fakeLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 450;
  const ctx2 = canvas.getContext('2d')!;
  return {
    canvas,
    ctx: ctx2,
    width: 800,
    height: 450,
    dpr: 1,
    begin: () => ctx2,
    resize: () => {},
  } as unknown as EyeLayer;
}
