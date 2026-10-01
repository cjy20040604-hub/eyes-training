/**
 * Unit conversions between prism diopters, screen distance, pixels, degrees and arcseconds.
 *
 * Definition: 1 prism diopter (Δ) deflects light by 1 cm at 1 m. Because
 * tan(θ) = Δ / 100 and the displacement on a screen at distance D is D · tan(θ),
 * the displacement is EXACTLY Δ · D centimetres (D in metres). No small-angle
 * approximation is involved in that step.
 *
 * All pixel values are CSS pixels. PPI is measured in CSS pixels per inch by the
 * credit-card calibration, so devicePixelRatio only matters when sizing a canvas
 * backing store, never in these conversions.
 */

export const CM_PER_INCH = 2.54;
/** ISO/IEC 7810 ID-1 card long edge in millimetres. */
export const ID1_CARD_WIDTH_MM = 85.6;
/** ISO/IEC 7810 ID-1 card short edge in millimetres. */
export const ID1_CARD_HEIGHT_MM = 53.98;

export const PLAUSIBLE_PPI = { min: 50, max: 400 } as const;
export const PLAUSIBLE_DISTANCE_CM = { min: 30, max: 120 } as const;
export const PLAUSIBLE_PRISM_DIOPTERS = { min: 0, max: 40 } as const;

export type PrismBase = 'in' | 'out' | 'up' | 'down';
export type Eye = 'left' | 'right';

export interface ScreenGeometry {
  /** Viewing distance in metres. */
  distanceM: number;
  /** CSS pixels per inch. */
  ppi: number;
}

export function prismDioptersToScreenCm(delta: number, distanceM: number): number {
  return delta * distanceM;
}

export function screenCmToPx(cm: number, ppi: number): number {
  return (cm / CM_PER_INCH) * ppi;
}

export function pxToScreenCm(px: number, ppi: number): number {
  return (px / ppi) * CM_PER_INCH;
}

export function prismDioptersToPx(delta: number, geometry: ScreenGeometry): number {
  return screenCmToPx(prismDioptersToScreenCm(delta, geometry.distanceM), geometry.ppi);
}

export function pxToPrismDiopters(px: number, geometry: ScreenGeometry): number {
  const cm = pxToScreenCm(px, geometry.ppi);
  return cm / geometry.distanceM;
}

export function prismDioptersToDegrees(delta: number): number {
  return (Math.atan(delta / 100) * 180) / Math.PI;
}

export function degreesToPrismDiopters(deg: number): number {
  return Math.tan((deg * Math.PI) / 180) * 100;
}

/** Linear screen size (px) subtended by a visual angle, centred on the line of sight. */
export function degreesToPx(deg: number, geometry: ScreenGeometry): number {
  const cm = 2 * geometry.distanceM * 100 * Math.tan((deg * Math.PI) / 360);
  return screenCmToPx(cm, geometry.ppi);
}

export function pxToArcsec(px: number, geometry: ScreenGeometry): number {
  const cm = pxToScreenCm(px, geometry.ppi);
  const rad = Math.atan(cm / (geometry.distanceM * 100));
  return (rad * 180 * 3600) / Math.PI;
}

export function arcsecToPx(arcsec: number, geometry: ScreenGeometry): number {
  const rad = (arcsec * Math.PI) / (180 * 3600);
  const cm = Math.tan(rad) * geometry.distanceM * 100;
  return screenCmToPx(cm, geometry.ppi);
}

/** PPI from the measured on-screen width (CSS px) of an ID-1 card's long edge. */
export function ppiFromCardWidthPx(matchedWidthPx: number): number {
  return matchedWidthPx / (ID1_CARD_WIDTH_MM / 25.4);
}

export function isPlausiblePpi(ppi: number): boolean {
  return Number.isFinite(ppi) && ppi >= PLAUSIBLE_PPI.min && ppi <= PLAUSIBLE_PPI.max;
}

export function isPlausibleDistanceCm(cm: number): boolean {
  return Number.isFinite(cm) && cm >= PLAUSIBLE_DISTANCE_CM.min && cm <= PLAUSIBLE_DISTANCE_CM.max;
}

export function isPlausiblePrismDiopters(delta: number): boolean {
  return (
    Number.isFinite(delta) && delta >= PLAUSIBLE_PRISM_DIOPTERS.min && delta <= PLAUSIBLE_PRISM_DIOPTERS.max
  );
}

export interface PrismSpec {
  amountDelta: number;
  base: PrismBase;
  /** Eye in front of which the prism sits. Determines nasal/temporal direction. */
  eye: Eye;
}

export interface PixelOffset {
  dx: number;
  dy: number;
}

/**
 * Direction of image displacement produced by a prism, as a unit vector in screen
 * coordinates (x to the right, y DOWN).
 *
 * A prism displaces the image toward its APEX:
 *   base-in  (apex temporal) -> image shifts temporally
 *   base-out (apex nasal)    -> image shifts nasally
 *   base-up  (apex down)     -> image shifts down
 *   base-down (apex up)      -> image shifts up
 * For the left eye, temporal is screen-left (-x); for the right eye it is screen-right (+x).
 */
export function prismDisplacementDirection(base: PrismBase, eye: Eye): PixelOffset {
  const temporalX = eye === 'left' ? -1 : 1;
  switch (base) {
    case 'in':
      return { dx: temporalX, dy: 0 };
    case 'out':
      return { dx: -temporalX, dy: 0 };
    case 'up':
      return { dx: 0, dy: 1 };
    case 'down':
      return { dx: 0, dy: -1 };
  }
}

/** Pixel offset to apply to one eye's image to emulate the given prism. */
export function prismToPixelOffset(spec: PrismSpec, geometry: ScreenGeometry): PixelOffset {
  const magnitude = prismDioptersToPx(spec.amountDelta, geometry);
  const dir = prismDisplacementDirection(spec.base, spec.eye);
  return { dx: dir.dx * magnitude, dy: dir.dy * magnitude };
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
