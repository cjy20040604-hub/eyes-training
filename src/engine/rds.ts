/**
 * Julesz random-dot stereogram (RDS), implemented from first principles.
 *
 * Both eyes see the same field of random dots, except inside a hidden target region:
 *  - the target's dots are shifted horizontally in the right eye's image by the disparity;
 *  - background dots that the shifted target now covers are removed (occlusion);
 *  - the strip the target uncovered is refilled with fresh random dots at the same density.
 * Each eye's image on its own is therefore a uniform random field with no visible edge or
 * density change (no monocular cue). The target only appears in depth when the two images
 * are fused, so a correct answer means real stereopsis.
 *
 * Crossed disparity: the right eye's target shifts LEFT, so the target appears in front.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dot {
  x: number;
  y: number;
}

export interface RdsOptions {
  /** Field rectangle in CSS px. */
  field: Rect;
  /** Hidden target rectangle in CSS px (inside the field). */
  target: Rect;
  /** Dot edge length in CSS px. */
  dotSize: number;
  /** Fraction of the field area covered by dots (0..1). */
  density: number;
  /** Horizontal disparity in CSS px; positive = crossed (target in front). */
  disparityPx: number;
  random: () => number;
}

export interface RdsImage {
  left: Dot[];
  right: Dot[];
  dotSize: number;
}

function inside(p: Dot, r: Rect, size: number): boolean {
  const cx = p.x + size / 2;
  const cy = p.y + size / 2;
  return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
}

function randomDots(region: Rect, count: number, size: number, random: () => number): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    dots.push({
      x: region.x + random() * Math.max(0, region.w - size),
      y: region.y + random() * Math.max(0, region.h - size),
    });
  }
  return dots;
}

function dotCount(region: Rect, size: number, density: number): number {
  return Math.round((region.w * region.h * density) / (size * size));
}

export function generateRds(o: RdsOptions): RdsImage {
  const { field, target, dotSize: s, density, disparityPx: d, random } = o;
  const left = randomDots(field, dotCount(field, s, density), s, random);

  // Where the target sits in the right eye's image.
  const shifted: Rect = { x: target.x - d, y: target.y, w: target.w, h: target.h };
  const right: Dot[] = [];
  for (const p of left) {
    if (inside(p, target, s)) {
      // Target dot: shift, keep only if it stays inside the field.
      const q = { x: p.x - d, y: p.y };
      if (q.x >= field.x && q.x + s <= field.x + field.w) right.push(q);
    } else if (!inside(p, shifted, s)) {
      // Background dot not occluded by the shifted target.
      right.push(p);
    }
  }

  // Refill the background strip the target uncovered in the right image.
  const strip: Rect =
    d >= 0
      ? { x: shifted.x + shifted.w, y: target.y, w: d, h: target.h }
      : { x: target.x, y: target.y, w: -d, h: target.h };
  if (strip.w > 0) {
    for (const p of randomDots(strip, dotCount(strip, s, density), s, random)) {
      if (!inside(p, shifted, s)) right.push(p);
    }
  }
  return { left, right, dotSize: s };
}

/** Dot coverage (dots per px²) of `dots` inside rectangle `r`, for no-monocular-cue checks. */
export function dotDensity(dots: Dot[], r: Rect, size: number): number {
  let n = 0;
  for (const p of dots) if (inside(p, r, size)) n++;
  return (n * size * size) / (r.w * r.h);
}

/** Round a disparity to whole device pixels so dots stay crisp; never below one device pixel. */
export function snapDisparity(px: number, dpr: number): number {
  const device = Math.max(1, Math.round(Math.abs(px) * dpr));
  return (Math.sign(px) || 1) * (device / dpr);
}
