import { Canvas2dAnaglyphBackend } from './Canvas2dAnaglyphBackend';
import { WebglAnaglyphBackend } from './WebglAnaglyphBackend';
import type { EyeLayers, RenderOptions, RendererId, StereoRenderer } from './types';

export type AnaglyphBackendKind = 'canvas2d' | 'webgl';

/** Red-cyan anaglyph renderer (primary). Backend is swappable at construction. */
export class AnaglyphRenderer implements StereoRenderer {
  readonly id: RendererId;
  readonly supported: boolean;
  private readonly backend: Canvas2dAnaglyphBackend | WebglAnaglyphBackend;

  constructor(kind: AnaglyphBackendKind = 'canvas2d') {
    if (kind === 'webgl' && WebglAnaglyphBackend.isSupported()) {
      this.backend = new WebglAnaglyphBackend();
      this.id = 'anaglyph-webgl';
    } else {
      this.backend = new Canvas2dAnaglyphBackend();
      this.id = 'anaglyph-canvas2d';
    }
    this.supported = true;
  }

  attach(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
    this.backend.attach(canvas, width, height, dpr);
  }

  resize(width: number, height: number, dpr: number): void {
    this.backend.resize(width, height, dpr);
  }

  composite(layers: EyeLayers, options: RenderOptions): void {
    this.backend.composite(layers, options);
  }

  dispose(): void {
    this.backend.dispose();
  }
}
