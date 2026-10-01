import { transformToMatrix } from '../affine';
import { channelColor, type EyeLayers, type RenderOptions } from './types';

/**
 * Canvas 2D anaglyph compositor. For each eye: draw the layer through its affine
 * transform into a scratch canvas, tint it to the eye's channel colour scaled by
 * gain x contrast (source-in), then add it to the output with 'lighter'. Additive
 * blending of red and cyan yields correct anaglyph output on a dark background.
 * Gamma is not supported here (use the WebGL backend); gain is linear.
 */
export class Canvas2dAnaglyphBackend {
  private out: HTMLCanvasElement | null = null;
  private outCtx: CanvasRenderingContext2D | null = null;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor() {
    this.scratch = document.createElement('canvas');
    const ctx = this.scratch.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.scratchCtx = ctx;
  }

  attach(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
    this.out = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.outCtx = ctx;
    this.resize(width, height, dpr);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    if (this.out) {
      this.out.width = Math.max(1, Math.round(width * dpr));
      this.out.height = Math.max(1, Math.round(height * dpr));
    }
    this.scratch.width = Math.max(1, Math.round(width * dpr));
    this.scratch.height = Math.max(1, Math.round(height * dpr));
  }

  composite(layers: EyeLayers, options: RenderOptions): void {
    const ctx = this.outCtx;
    if (!ctx) return;
    const { width, height, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const bg = options.backgroundGray;
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, this.scratch.width, this.scratch.height);

    for (const eye of ['left', 'right'] as const) {
      const layer = layers[eye];
      const channel = options.channels[eye];
      const intensity = channel.gain * options.contrast[eye];
      const [r, g, b] = channelColor(channel.channel, intensity);
      const s = this.scratchCtx;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'source-over';
      s.clearRect(0, 0, this.scratch.width, this.scratch.height);
      const m = transformToMatrix(options.transforms[eye], width / 2, height / 2);
      // Layer backing store is dpr-scaled; map CSS coords -> device coords.
      s.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
      s.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, width, height);
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = `rgb(${r},${g},${b})`;
      s.fillRect(0, 0, this.scratch.width, this.scratch.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.scratch, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    this.out = null;
    this.outCtx = null;
  }
}
