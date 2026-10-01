import { describe, expect, it } from 'vitest';
import {
  MAX_ROTATION_DEG,
  addTransform,
  applyMatrix,
  clampTransform,
  inverseMatrix,
  scaleTransform,
  transformToMatrix,
} from '../../src/engine/affine';

describe('per-eye affine transform', () => {
  it('translation moves the centre by (dx, dy)', () => {
    const m = transformToMatrix({ dx: 10, dy: -5, rotationDeg: 0 }, 100, 50);
    expect(applyMatrix(m, 100, 50)).toEqual({ x: 110, y: 45 });
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 10, y: -5 });
  });

  it('rotation is about the centre', () => {
    const m = transformToMatrix({ dx: 0, dy: 0, rotationDeg: 90 }, 100, 50);
    const c = applyMatrix(m, 100, 50);
    expect(c.x).toBeCloseTo(100);
    expect(c.y).toBeCloseTo(50);
    const p = applyMatrix(m, 110, 50);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(60);
  });

  it('inverse undoes the transform', () => {
    const m = transformToMatrix({ dx: 33, dy: -12, rotationDeg: 3.5 }, 400, 225);
    const inv = inverseMatrix(m);
    const p = applyMatrix(m, 123, 456);
    const back = applyMatrix(inv, p.x, p.y);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(456, 6);
  });

  it('clamps rotation to the safety ceiling and sanitises NaN', () => {
    expect(clampTransform({ dx: NaN, dy: 1, rotationDeg: 50 })).toEqual({
      dx: 0,
      dy: 1,
      rotationDeg: MAX_ROTATION_DEG,
    });
  });

  it('scale keeps rotation but scales translation (offset reduction)', () => {
    expect(scaleTransform({ dx: -100, dy: 20, rotationDeg: 2 }, 0.8)).toEqual({
      dx: -80,
      dy: 16,
      rotationDeg: 2,
    });
  });

  it('adds transforms', () => {
    expect(addTransform({ dx: 1, dy: 2, rotationDeg: 1 }, { dx: 3, dy: 4, rotationDeg: -0.5 })).toEqual({
      dx: 4,
      dy: 6,
      rotationDeg: 0.5,
    });
  });
});
