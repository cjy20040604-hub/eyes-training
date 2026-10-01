import type { EyeLayers, RenderOptions, RendererId, StereoRenderer } from './types';

/**
 * Placeholder for a future WebXR path. Reports unsupported and renders nothing.
 * When implemented it must add cybersickness warnings and comfort options first.
 */
export class WebXRRenderer implements StereoRenderer {
  readonly id: RendererId = 'webxr';
  readonly supported = false;

  attach(_canvas: HTMLCanvasElement, _width: number, _height: number, _dpr: number): void {
    // not implemented
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // not implemented
  }

  composite(_layers: EyeLayers, _options: RenderOptions): void {
    // not implemented
  }

  dispose(): void {
    // nothing to release
  }
}
