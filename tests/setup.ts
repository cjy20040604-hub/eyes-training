import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Canvas 2D is not implemented in jsdom; provide a minimal stub so components that
// create contexts do not crash. Rendering correctness is verified in engine unit tests
// that operate on pure data, and in Playwright.
const noop = () => {};
function ctxStub(): CanvasRenderingContext2D {
  return {
    canvas: {},
    save: noop,
    restore: noop,
    setTransform: noop,
    resetTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    arc: noop,
    ellipse: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    transform: noop,
    fillText: noop,
    drawImage: noop,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: 'srgb',
    }),
    measureText: () => ({ width: 0 }),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    ctxStub,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
