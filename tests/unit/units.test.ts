import { describe, expect, it } from 'vitest';
import {
  arcsecToPx,
  degreesToPx,
  isPlausibleDistanceCm,
  isPlausiblePpi,
  ppiFromCardWidthPx,
  prismDioptersToDegrees,
  prismDioptersToPx,
  prismDioptersToScreenCm,
  prismToPixelOffset,
  pxToArcsec,
  pxToPrismDiopters,
  screenCmToPx,
} from '../../src/engine/units';

describe('prism diopter conversions (worked examples)', () => {
  it('1Δ deflects 1 cm at 1 m', () => {
    expect(prismDioptersToScreenCm(1, 1)).toBeCloseTo(1, 10);
  });

  it('7Δ at 0.60 m = 4.20 cm = 158.7 px @ 96 PPI', () => {
    expect(prismDioptersToScreenCm(7, 0.6)).toBeCloseTo(4.2, 10);
    expect(prismDioptersToPx(7, { distanceM: 0.6, ppi: 96 })).toBeCloseTo(158.74, 1);
  });

  it('7Δ at 0.50 m = 3.50 cm = 132.3 px @ 96 PPI', () => {
    expect(prismDioptersToPx(7, { distanceM: 0.5, ppi: 96 })).toBeCloseTo(132.28, 1);
  });

  it('10Δ at 1.00 m = 10 cm = 378.0 px @ 96 PPI', () => {
    expect(prismDioptersToPx(10, { distanceM: 1, ppi: 96 })).toBeCloseTo(377.95, 1);
  });

  it('7Δ is about 4.00 degrees', () => {
    expect(prismDioptersToDegrees(7)).toBeCloseTo(4.004, 2);
  });

  it('round-trips px -> Δ', () => {
    const g = { distanceM: 0.6, ppi: 110 };
    const px = prismDioptersToPx(7, g);
    expect(pxToPrismDiopters(px, g)).toBeCloseTo(7, 10);
  });

  it('scales linearly with PPI and distance', () => {
    expect(screenCmToPx(2.54, 200)).toBeCloseTo(200, 10);
    expect(prismDioptersToPx(7, { distanceM: 1.2, ppi: 96 })).toBeCloseTo(
      2 * prismDioptersToPx(7, { distanceM: 0.6, ppi: 96 }),
      6,
    );
  });
});

describe('credit-card PPI calibration', () => {
  it('computes PPI from the matched ID-1 card width', () => {
    // 85.6 mm = 3.3701 in. At 96 PPI the card is 323.5 px wide.
    expect(ppiFromCardWidthPx(323.53)).toBeCloseTo(96, 1);
  });

  it('refuses implausible values', () => {
    expect(isPlausiblePpi(ppiFromCardWidthPx(50))).toBe(false);
    expect(isPlausiblePpi(ppiFromCardWidthPx(5000))).toBe(false);
    expect(isPlausiblePpi(ppiFromCardWidthPx(324))).toBe(true);
    expect(isPlausibleDistanceCm(20)).toBe(false);
    expect(isPlausibleDistanceCm(60)).toBe(true);
  });
});

describe('prism base direction -> pixel offset', () => {
  const g = { distanceM: 0.6, ppi: 96 };
  const mag = prismDioptersToPx(7, g);

  it('base-in on the left eye shifts the image temporally (screen left)', () => {
    const o = prismToPixelOffset({ amountDelta: 7, base: 'in', eye: 'left' }, g);
    expect(o.dx).toBeCloseTo(-mag, 6);
    expect(o.dy).toBe(0);
  });

  it('base-in on the right eye shifts the image temporally (screen right)', () => {
    const o = prismToPixelOffset({ amountDelta: 7, base: 'in', eye: 'right' }, g);
    expect(o.dx).toBeCloseTo(mag, 6);
  });

  it('base-out is the opposite of base-in', () => {
    const inL = prismToPixelOffset({ amountDelta: 7, base: 'in', eye: 'left' }, g);
    const outL = prismToPixelOffset({ amountDelta: 7, base: 'out', eye: 'left' }, g);
    expect(outL.dx).toBeCloseTo(-inL.dx, 6);
  });

  it('base-up shifts the image down (toward the apex); base-down shifts up', () => {
    expect(prismToPixelOffset({ amountDelta: 2, base: 'up', eye: 'left' }, g).dy).toBeGreaterThan(0);
    expect(prismToPixelOffset({ amountDelta: 2, base: 'down', eye: 'left' }, g).dy).toBeLessThan(0);
  });
});

describe('visual angle helpers', () => {
  const g = { distanceM: 0.6, ppi: 96 };
  it('one pixel at 60 cm / 96 PPI is about 91 arcsec', () => {
    expect(pxToArcsec(1, g)).toBeCloseTo(91, 0);
    expect(arcsecToPx(pxToArcsec(1, g), g)).toBeCloseTo(1, 8);
  });
  it('10 degree field at 60 cm / 96 PPI is about 397 px wide', () => {
    expect(degreesToPx(10, g)).toBeCloseTo(396.8, 0);
  });
});
