import { transformToMatrix } from '../affine';
import type { EyeLayers, RenderOptions, RendererId, StereoRenderer } from './types';

/**
 * Side-by-side renderer: left eye image on the left half, right eye on the right half,
 * grayscale, with the same per-eye transforms and contrast. Basis for a future VR /
 * cardboard path. Functional but minimal.
 */
export class SbsRenderer implements StereoRenderer {
  readonly id: RendererId = 'sbs';
  readonly supported = true;
  private out: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;

  attach(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
    this.out = canvas;
    this.ctx = canvas.getContext('2d');
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
  }

  composite(layers: EyeLayers, options: RenderOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height, dpr } = this;
    const bg = options.backgroundGray;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, width, height);
    const half = width / 2;
    (['left', 'right'] as const).forEach((eye, i) => {
      const layer = layers[eye];
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * half, 0, half, height);
      ctx.clip();
      const m = transformToMatrix(options.transforms[eye], half / 2, height / 2);
      ctx.transform(m[0], m[1], m[2], m[3], m[4] + i * half, m[5]);
      ctx.globalAlpha = options.channels[eye].gain * options.contrast[eye];
      // Fit the full-width layer into the half-width viewport.
      ctx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, half, height);
      ctx.restore();
    });
  }

  dispose(): void {
    this.out = null;
    this.ctx = null;
  }
}
