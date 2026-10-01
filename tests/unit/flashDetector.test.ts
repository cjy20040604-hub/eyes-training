import { describe, expect, it } from 'vitest';
import {
  FlashDetector,
  WCAG_REFERENCE_AREA_PX2,
  flashAreaThresholdPx2,
  relativeLuminance,
} from '../../src/engine/flashDetector';

const GRID_W = 16;
const GRID_H = 9;
const FRAME_W = 1024;
const FRAME_H = 576;

function frame(fill: (i: number) => [number, number, number]): Uint8ClampedArray {
  const n = GRID_W * GRID_H;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fill(i);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [255, 0, 0];

function makeDetector(areaPx2 = WCAG_REFERENCE_AREA_PX2) {
  return new FlashDetector({
    gridWidth: GRID_W,
    gridHeight: GRID_H,
    frameWidthPx: FRAME_W,
    frameHeightPx: FRAME_H,
    areaThresholdPx2: areaPx2,
  });
}

/** Play a full-screen square wave at `hz` for `seconds` at 60 fps. Returns the worst report. */
function play(
  detector: FlashDetector,
  hz: number,
  seconds: number,
  colors: [[number, number, number], [number, number, number]] = [BLACK, WHITE],
  areaFraction = 1,
) {
  let worst = detector.report;
  const n = GRID_W * GRID_H;
  const cutoff = Math.floor(n * areaFraction);
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60;
    const on = Math.floor(t * hz * 2) % 2 === 1;
    const color = on ? colors[1] : colors[0];
    const rep = detector.analyzeFrame(
      frame((i) => (i < cutoff ? color : BLACK)),
      f * (1000 / 60),
    );
    if (rep.flashRate > worst.flashRate || rep.redFlashRate > worst.redFlashRate || rep.level === 'danger')
      worst = rep;
  }
  return worst;
}

describe('relative luminance', () => {
  it('matches WCAG for black, white and mid gray', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.2158, 3);
  });
});

describe('FlashDetector', () => {
  it('is ok for a static frame', () => {
    const d = makeDetector();
    for (let f = 0; f < 120; f++)
      d.analyzeFrame(
        frame(() => WHITE),
        f * 16.7,
      );
    expect(d.report.level).toBe('ok');
    expect(d.report.flashRate).toBe(0);
  });

  it('flags 4 flashes/s full-screen as danger', () => {
    const rep = play(makeDetector(), 4, 2);
    expect(rep.level).toBe('danger');
    expect(rep.flashRate).toBeGreaterThanOrEqual(3);
  });

  it('flags 10 Hz flicker (inside the 3-60 Hz risk band) as danger', () => {
    const rep = play(makeDetector(), 10, 2);
    expect(rep.level).toBe('danger');
  });

  it('warns at 2 flashes/s but does not pause', () => {
    const rep = play(makeDetector(), 2, 3);
    expect(rep.flashRate).toBeGreaterThanOrEqual(2);
    expect(rep.flashRate).toBeLessThan(3);
    expect(rep.level).toBe('warn');
  });

  it('stays ok at 1 flash/s', () => {
    const rep = play(makeDetector(), 1, 3);
    expect(rep.level).toBe('ok');
  });

  it('ignores transitions spaced 334 ms apart (3 transitions/s = 1.5 flashes/s)', () => {
    const d = makeDetector();
    let on = false;
    let worst = 0;
    for (let ms = 0; ms < 4000; ms += 16.7) {
      if (Math.floor(ms / 334) !== Math.floor((ms - 16.7) / 334)) on = !on;
      const rep = d.analyzeFrame(
        frame(() => (on ? WHITE : BLACK)),
        ms,
      );
      worst = Math.max(worst, rep.flashRate);
    }
    expect(worst).toBeLessThan(3);
    expect(d.report.level).not.toBe('danger');
  });

  it('ignores small-area flicker below the area threshold', () => {
    // 5% of the frame at 8 Hz: area 0.05 * 1024 * 576 = 29,491 px² < 87,296 px² threshold.
    const rep = play(makeDetector(), 8, 2, [BLACK, WHITE], 0.05);
    expect(rep.level).toBe('ok');
  });

  it('counts large-area flicker above the area threshold', () => {
    const rep = play(makeDetector(), 8, 2, [BLACK, WHITE], 0.3);
    expect(rep.level).toBe('danger');
  });

  it('ignores luminance changes below 10% or where the darker state is >= 0.8', () => {
    const d = makeDetector();
    // 230 -> 255: darker state luminance ~0.79? 230/255 -> linear 0.79; keep both bright: 240 vs 255 (0.87 vs 1.0)
    let worst = 0;
    for (let f = 0; f < 180; f++) {
      const on = Math.floor(f / 4) % 2 === 1;
      const v = on ? 255 : 240;
      worst = Math.max(
        worst,
        d.analyzeFrame(
          frame(() => [v, v, v]),
          f * 16.7,
        ).flashRate,
      );
    }
    expect(worst).toBe(0);
  });

  it('detects saturated red flashes', () => {
    const rep = play(makeDetector(), 5, 2, [BLACK, RED]);
    expect(rep.redFlashRate).toBeGreaterThanOrEqual(3);
    expect(rep.level).toBe('danger');
  });

  it('reset clears history', () => {
    const d = makeDetector();
    play(d, 6, 1);
    d.reset();
    for (let f = 0; f < 60; f++)
      d.analyzeFrame(
        frame(() => BLACK),
        5000 + f * 16.7,
      );
    expect(d.report.level).toBe('ok');
  });
});

describe('flashAreaThresholdPx2', () => {
  it('falls back to the WCAG reference when geometry is unknown', () => {
    expect(flashAreaThresholdPx2(null)).toBe(WCAG_REFERENCE_AREA_PX2);
  });
  it('uses 25% of a 10° disc when geometry is known', () => {
    const d = 400; // px diameter of a 10° field
    expect(flashAreaThresholdPx2(d)).toBeCloseTo(0.25 * Math.PI * 200 * 200, 3);
  });
});
