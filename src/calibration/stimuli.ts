import type { WorthFourDotResult } from '../data/schema';
import type { EyeChannelMap } from '../engine/renderer';
import type { StaircaseConfig } from '../engine/staircase';
import type { CalibDraw } from './CalibCanvas';

/**
 * Calibration stimuli: pure drawing functions (left layer, right layer, width, height)
 * and the Worth 4-dot interpretation. Kept out of Wizard.tsx so they can be tested
 * without rendering the wizard.
 */

type Ctx = CanvasRenderingContext2D;

/**
 * Dichoptic contrast balance staircase (calibration and weekly check): the dominant eye's
 * contrast steps down while it looks stronger, up while it looks weaker.
 */
export const CONTRAST_STAIRCASE: StaircaseConfig = {
  start: 1,
  min: 0.05,
  max: 1,
  step: 0.1,
  up: 1,
  down: 1,
  harderDirection: -1,
  maxReversals: 6,
  stepAfterReversals: [{ reversals: 2, step: 0.05 }],
};

/** The layer whose eye looks through the red filter, and the one through cyan. */
export function filterLayers(channels: EyeChannelMap, l: Ctx, r: Ctx): { red: Ctx; cyan: Ctx } {
  return channels.left.channel === 'red' ? { red: l, cyan: r } : { red: r, cyan: l };
}

function labelledSquare(c: Ctx, x: number, y: number, w: number, h: number, label: string, fontPx: number) {
  c.fillStyle = '#fff';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#000';
  c.font = `${fontPx}px sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, x + w / 2, y + h / 2);
}

/** Square A in the red channel, square B in the cyan channel: which one does each eye see? */
export function glassesStimulus(channels: EyeChannelMap): CalibDraw {
  return (l, r, w, h) => {
    const { red, cyan } = filterLayers(channels, l, r);
    const font = Math.round(h * 0.3);
    labelledSquare(red, w * 0.15, h * 0.25, w * 0.3, h * 0.5, 'A', font);
    labelledSquare(cyan, w * 0.55, h * 0.25, w * 0.3, h * 0.5, 'B', font);
  };
}

/** A left-eye-only disc, used to tune the background so it does not ghost into the right eye. */
export const ghostStimulus: CalibDraw = (l, _r, w, h) => {
  l.fillStyle = '#fff';
  l.beginPath();
  l.arc(w * 0.5, h * 0.5, h * 0.2, 0, Math.PI * 2);
  l.fill();
};

/** Left eye only: a triangle. */
export const monoLeftStimulus: CalibDraw = (l, _r, w, h) => {
  l.fillStyle = '#fff';
  l.beginPath();
  l.moveTo(w * 0.5, h * 0.2);
  l.lineTo(w * 0.7, h * 0.8);
  l.lineTo(w * 0.3, h * 0.8);
  l.closePath();
  l.fill();
};

/** Right eye only: a square. */
export const monoRightStimulus: CalibDraw = (_l, r, w, h) => {
  r.fillStyle = '#fff';
  r.fillRect(w * 0.35, h * 0.25, w * 0.3, h * 0.5);
};

/** Worth 4-dot: top dot red eye only, left/right dots cyan eye only, bottom dot both eyes. */
export function worthStimulus(channels: EyeChannelMap): CalibDraw {
  return (l, r, w, h) => {
    const { red, cyan } = filterLayers(channels, l, r);
    const cx = w / 2;
    const cy = h / 2;
    const rad = h * 0.07;
    const dot = (c: Ctx, x: number, y: number) => {
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, y, rad, 0, Math.PI * 2);
      c.fill();
    };
    dot(red, cx, cy - h * 0.25);
    dot(cyan, cx - w * 0.15, cy);
    dot(cyan, cx + w * 0.15, cy);
    dot(l, cx, cy + h * 0.25);
    dot(r, cx, cy + h * 0.25);
  };
}

/** Prism offset: both eyes see a frame; the left eye a cross, the right eye a ring. */
export const offsetStimulus: CalibDraw = (l, r, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  for (const c of [l, r]) {
    c.strokeStyle = '#888';
    c.lineWidth = 3;
    c.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
  }
  l.strokeStyle = '#fff';
  l.lineWidth = 4;
  l.beginPath();
  l.moveTo(cx - h * 0.12, cy);
  l.lineTo(cx + h * 0.12, cy);
  l.moveTo(cx, cy - h * 0.12);
  l.lineTo(cx, cy + h * 0.12);
  l.stroke();
  r.strokeStyle = '#fff';
  r.lineWidth = 4;
  r.beginPath();
  r.arc(cx, cy, h * 0.08, 0, Math.PI * 2);
  r.stroke();
};

/** Contrast balance: one bar per eye inside a shared frame. */
export const contrastStimulus: CalibDraw = (l, r, w, h) => {
  l.fillStyle = '#fff';
  l.fillRect(w * 0.3, h * 0.2, w * 0.12, h * 0.6);
  r.fillStyle = '#fff';
  r.fillRect(w * 0.58, h * 0.2, w * 0.12, h * 0.6);
  for (const c of [l, r]) {
    c.strokeStyle = '#777';
    c.lineWidth = 2;
    c.strokeRect(w * 0.2, h * 0.1, w * 0.6, h * 0.8);
  }
};

/**
 * Interpret the Worth 4-dot answer:
 *  - 4 dots: fusion; 5 dots: diplopia; alternating 2/3: alternating suppression;
 *  - 2 dots: only the red-filter eye sees (top + bottom), so the cyan-filter eye is suppressed;
 *  - 3 dots: only the cyan-filter eye sees (left, right, bottom), so the red-filter eye is suppressed.
 */
export function worthFourDotResult(
  dotsSeen: number | null,
  alternating: boolean,
  channels: EyeChannelMap,
): WorthFourDotResult {
  const redEye = channels.left.channel === 'red' ? 'left' : 'right';
  const cyanEye = redEye === 'left' ? 'right' : 'left';
  if (alternating) return 'alternating';
  if (dotsSeen === 4) return 'fusion';
  if (dotsSeen === 5) return 'diplopia';
  if (dotsSeen === 2) return `${cyanEye}-suppression`;
  if (dotsSeen === 3) return `${redEye}-suppression`;
  return 'unknown';
}
