/**
 * Per-eye affine transform = virtual prism (translation) plus optional cyclotorsion
 * compensation (rotation about the stimulus centre). Rotation defaults to 0 and is
 * only ever changed in tiny steps by the user.
 */
export interface EyeTransform {
  /** Horizontal shift in CSS px, positive = screen right. */
  dx: number;
  /** Vertical shift in CSS px, positive = screen down. */
  dy: number;
  /** Rotation in degrees, positive = clockwise on screen. */
  rotationDeg: number;
}

export type Matrix2x3 = [number, number, number, number, number, number];

export const IDENTITY_TRANSFORM: Readonly<EyeTransform> = Object.freeze({ dx: 0, dy: 0, rotationDeg: 0 });

/** Max rotation step allowed per adjustment (degrees). */
export const MAX_ROTATION_STEP_DEG = 0.5;
/** Absolute rotation ceiling (degrees). Objective excyclotorsion in SO palsy is ~5°. */
export const MAX_ROTATION_DEG = 8;

export function clampTransform(t: EyeTransform): EyeTransform {
  const rot = Number.isFinite(t.rotationDeg) ? t.rotationDeg : 0;
  return {
    dx: Number.isFinite(t.dx) ? t.dx : 0,
    dy: Number.isFinite(t.dy) ? t.dy : 0,
    rotationDeg: Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, rot)),
  };
}

export function scaleTransform(t: EyeTransform, factor: number): EyeTransform {
  return { dx: t.dx * factor, dy: t.dy * factor, rotationDeg: t.rotationDeg };
}

export function addTransform(a: EyeTransform, b: EyeTransform): EyeTransform {
  return clampTransform({ dx: a.dx + b.dx, dy: a.dy + b.dy, rotationDeg: a.rotationDeg + b.rotationDeg });
}

/** 2x3 matrix [a b c d e f] mapping layer coords to screen coords, rotating about (cx, cy). */
export function transformToMatrix(t: EyeTransform, cx: number, cy: number): Matrix2x3 {
  const r = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // translate(cx+dx, cy+dy) * rotate(r) * translate(-cx, -cy)
  const e = cx + t.dx - cos * cx + sin * cy;
  const f = cy + t.dy - sin * cx - cos * cy;
  return [cos, sin, -sin, cos, e, f];
}

/** Inverse of a 2x3 affine matrix, for shader-side sampling. */
export function inverseMatrix(m: Matrix2x3): Matrix2x3 {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const iff = -(ib * e + id * f);
  return [ia, ib, ic, id, ie, iff];
}

export function applyMatrix(m: Matrix2x3, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
