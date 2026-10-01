/**
 * A per-eye drawing surface. Modules draw luminance-only shapes (white / gray on
 * transparent) here; a StereoRenderer later tints and composites the two layers.
 * Layers are sized in CSS px with a devicePixelRatio-scaled backing store.
 */
export class EyeLayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private _width = 0;
  private _height = 0;
  private _dpr = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for eye layer');
    this.ctx = ctx;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get dpr(): number {
    return this._dpr;
  }

  resize(width: number, height: number, dpr: number): void {
    this._width = width;
    this._height = height;
    this._dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  /** Clear and reset the transform so drawing is in CSS px. */
  begin(): CanvasRenderingContext2D {
    const { ctx } = this;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this._width, this._height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return ctx;
  }
}
