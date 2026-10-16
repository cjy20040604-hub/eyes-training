import { AnaglyphRenderer } from './AnaglyphRenderer';
import { SbsRenderer } from './SbsRenderer';
import { WebXRRenderer } from './xr';
import type { RendererId, StereoRenderer } from './types';

export * from './types';
export { EyeLayer } from './EyeLayer';
export { AnaglyphRenderer } from './AnaglyphRenderer';
export { SbsRenderer } from './SbsRenderer';
export { WebXRRenderer } from './xr';

export function createRenderer(id: RendererId): StereoRenderer {
  switch (id) {
    case 'anaglyph-canvas2d':
      return new AnaglyphRenderer('canvas2d');
    case 'anaglyph-webgl':
      return new AnaglyphRenderer('webgl');
    case 'sbs':
      return new SbsRenderer();
    case 'webxr':
      return new WebXRRenderer();
  }
}

export const RENDERER_IDS: RendererId[] = ['anaglyph-canvas2d', 'anaglyph-webgl', 'sbs', 'webxr'];
