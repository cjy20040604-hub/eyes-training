/**
 * Client-side photosensitivity guard: watches rendered frames and reports when the
 * content approaches the WCAG 2.3.1 / Harding / ITU-R BT.1702 thresholds.
 *
 * Model (per grid cell of a downsampled frame):
 *  - Relative luminance Y = 0.2126 R + 0.7152 G + 0.0722 B on linearised sRGB (WCAG).
 *  - A TRANSITION is a change in Y of >= 0.10 (of the maximum relative luminance) where
 *    the darker state is < 0.80. Transitions are tracked as excursions: the reference
 *    luminance follows the current extreme, and an opposing move that exceeds the
 *    threshold counts as the next transition.
 *  - A FLASH is a pair of opposing transitions. Flashes per second for a cell =
 *    transitions in the last 1000 ms / 2.
 *  - A RED FLASH is a pair of opposing transitions where one state is saturated red
 *    (R / (R+G+B) >= 0.8 with R linear >= 0.1) and the other is not, or the red-difference
 *    metric changes by >= 0.2. This follows the PEAT / Harding approximation.
 *  - AREA: only flashes covering at least `areaThresholdPx2` concurrently count. WCAG
 *    defines that as 25% of a 10° visual field. When screen geometry (PPI, distance) is
 *    known the app computes it in real pixels; otherwise it falls back to WCAG's
 *    341 x 256 px reference (87,296 px²).
 *  - The reported rate is the highest flashes-per-second value that is reached by a
 *    set of cells whose combined area meets the area threshold.
 *
 * Levels: 'ok' below warnRate, 'warn' at >= warnRate (default 2/s: approaching the
 * limit), 'danger' at >= dangerRate (default 3/s: the app must pause). WCAG permits
 * up to 3; we treat 3 as the pause point for margin.
 *
 * Any frequency from 3 Hz to 60 Hz is covered by the same counter, since higher
 * frequencies simply produce more transitions per window.
 */

export interface FlashDetectorConfig {
  gridWidth: number;
  gridHeight: number;
  /** Frame size in CSS px that the grid represents. */
  frameWidthPx: number;
  frameHeightPx: number;
  /** Flashing area (px²) required for a flash to count. */
  areaThresholdPx2: number;
  windowMs?: number;
  luminanceDelta?: number;
  darkerBelow?: number;
  warnRate?: number;
  dangerRate?: number;
}

export type FlashLevel = 'ok' | 'warn' | 'danger';

export interface FlashReport {
  level: FlashLevel;
  /** Highest general-flash rate (flashes/s) reached over at least the threshold area. */
  flashRate: number;
  /** Highest red-flash rate (flashes/s) reached over at least the threshold area. */
  redFlashRate: number;
  /** Fraction of frame area currently flashing at >= 1 flash/s. */
  flashingAreaFraction: number;
  timestampMs: number;
  /** True when the frame could not be read (cross-origin video), so it cannot be checked. */
  unverifiable?: boolean;
}

/** WCAG reference: 25% of a 10° field at 1024x768 / typical distance = 341 x 256 px. */
export const WCAG_REFERENCE_AREA_PX2 = 341 * 256;

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * (SRGB_TO_LINEAR[r] ?? 0) + 0.7152 * (SRGB_TO_LINEAR[g] ?? 0) + 0.0722 * (SRGB_TO_LINEAR[b] ?? 0)
  );
}

/** Red-difference metric used for red flash detection. */
export function redSaturation(r: number, g: number, b: number): { sat: number; red: number } {
  const rl = SRGB_TO_LINEAR[r] ?? 0;
  const gl = SRGB_TO_LINEAR[g] ?? 0;
  const bl = SRGB_TO_LINEAR[b] ?? 0;
  const sum = rl + gl + bl;
  return { sat: sum > 0 ? rl / sum : 0, red: rl };
}

interface CellState {
  refLum: number;
  dir: 1 | -1 | 0;
  transitions: number[];
  redState: boolean;
  redTransitions: number[];
}

export class FlashDetector {
  private readonly cells: CellState[];
  private readonly cellAreaPx2: number;
  private readonly cellsNeeded: number;
  private readonly windowMs: number;
  private readonly lumDelta: number;
  private readonly darkerBelow: number;
  private readonly warnRate: number;
  private readonly dangerRate: number;
  private lastReport: FlashReport;

  constructor(private readonly config: FlashDetectorConfig) {
    const n = config.gridWidth * config.gridHeight;
    this.cells = Array.from({ length: n }, () => ({
      refLum: -1,
      dir: 0,
      transitions: [],
      redState: false,
      redTransitions: [],
    }));
    this.cellAreaPx2 = (config.frameWidthPx / config.gridWidth) * (config.frameHeightPx / config.gridHeight);
    this.cellsNeeded = Math.max(1, Math.ceil(config.areaThresholdPx2 / this.cellAreaPx2));
    this.windowMs = config.windowMs ?? 1000;
    this.lumDelta = config.luminanceDelta ?? 0.1;
    this.darkerBelow = config.darkerBelow ?? 0.8;
    this.warnRate = config.warnRate ?? 2;
    this.dangerRate = config.dangerRate ?? 3;
    this.lastReport = { level: 'ok', flashRate: 0, redFlashRate: 0, flashingAreaFraction: 0, timestampMs: 0 };
  }

  get report(): FlashReport {
    return this.lastReport;
  }

  reset(): void {
    for (const c of this.cells) {
      c.refLum = -1;
      c.dir = 0;
      c.transitions.length = 0;
      c.redState = false;
      c.redTransitions.length = 0;
    }
  }

  /**
   * Analyse one downsampled frame. `rgba` must be gridWidth*gridHeight*4 bytes.
   */
  analyzeFrame(rgba: Uint8ClampedArray | Uint8Array, timestampMs: number): FlashReport {
    const n = this.cells.length;
    const cutoff = timestampMs - this.windowMs;
    const flashCounts = new Float32Array(n);
    const redCounts = new Float32Array(n);
    let flashingCells = 0;

    for (let i = 0; i < n; i++) {
      const cell = this.cells[i]!;
      const o = i * 4;
      const r = rgba[o] ?? 0;
      const g = rgba[o + 1] ?? 0;
      const b = rgba[o + 2] ?? 0;
      const lum = relativeLuminance(r, g, b);

      // ---- General flash: excursion tracking ----
      if (cell.refLum < 0) {
        cell.refLum = lum;
      } else {
        const delta = lum - cell.refLum;
        const darker = Math.min(lum, cell.refLum);
        const sign: 1 | -1 | 0 = delta > 0 ? 1 : delta < 0 ? -1 : 0;
        if (sign !== 0 && sign === cell.dir) {
          // continuing in the same direction: extend the excursion
          cell.refLum = lum;
        } else if (sign !== 0 && Math.abs(delta) >= this.lumDelta && darker < this.darkerBelow) {
          cell.transitions.push(timestampMs);
          cell.dir = sign;
          cell.refLum = lum;
        }
      }

      // ---- Red flash ----
      const { sat, red } = redSaturation(r, g, b);
      const isSatRed = sat >= 0.8 && red >= 0.1;
      if (isSatRed !== cell.redState) {
        if (cell.refLum >= 0) cell.redTransitions.push(timestampMs);
        cell.redState = isSatRed;
      }

      // ---- Prune windows & count ----
      while (cell.transitions.length && (cell.transitions[0] ?? 0) < cutoff) cell.transitions.shift();
      while (cell.redTransitions.length && (cell.redTransitions[0] ?? 0) < cutoff)
        cell.redTransitions.shift();
      flashCounts[i] = cell.transitions.length / 2;
      redCounts[i] = cell.redTransitions.length / 2;
      if (flashCounts[i]! >= 1) flashingCells++;
    }

    const flashRate = this.rateOverArea(flashCounts);
    const redFlashRate = this.rateOverArea(redCounts);
    const worst = Math.max(flashRate, redFlashRate);
    const level: FlashLevel = worst >= this.dangerRate ? 'danger' : worst >= this.warnRate ? 'warn' : 'ok';
    this.lastReport = {
      level,
      flashRate,
      redFlashRate,
      flashingAreaFraction: flashingCells / n,
      timestampMs,
    };
    return this.lastReport;
  }

  /** Highest rate achieved by at least `cellsNeeded` cells simultaneously. */
  private rateOverArea(counts: Float32Array): number {
    if (this.cellsNeeded > counts.length) return 0;
    const sorted = Array.from(counts).sort((a, b) => b - a);
    return sorted[this.cellsNeeded - 1] ?? 0;
  }
}

/**
 * Browser helper: downsample a source canvas into a tiny grid and return the RGBA bytes.
 * Throws if the canvas is tainted (e.g. non-CORS video), which callers must treat as
 * "cannot verify, do not play".
 */
export class FrameSampler {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly gridWidth: number,
    readonly gridHeight: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = gridWidth;
    this.canvas.height = gridHeight;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable for frame sampler');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
  }

  sample(source: CanvasImageSource): Uint8ClampedArray {
    this.ctx.drawImage(source, 0, 0, this.gridWidth, this.gridHeight);
    return this.ctx.getImageData(0, 0, this.gridWidth, this.gridHeight).data;
  }
}

/** Area (px²) of 25% of a 10° visual field for the given geometry, or the WCAG reference. */
export function flashAreaThresholdPx2(tenDegreeFieldDiameterPx: number | null): number {
  if (!tenDegreeFieldDiameterPx || !Number.isFinite(tenDegreeFieldDiameterPx)) return WCAG_REFERENCE_AREA_PX2;
  const r = tenDegreeFieldDiameterPx / 2;
  return 0.25 * Math.PI * r * r;
}
