import { useEffect, useRef } from 'react';
import { EyeLayer, createRenderer, type RenderOptions, type StereoRenderer } from '../engine/renderer';

export type CalibDraw = (
  left: CanvasRenderingContext2D,
  right: CanvasRenderingContext2D,
  width: number,
  height: number,
) => void;

/** Static anaglyph preview used by wizard steps. Re-renders when options or draw change. */
export function CalibCanvas({
  options,
  draw,
  testId,
}: {
  options: RenderOptions;
  draw: CalibDraw;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StereoRenderer | null>(null);
  const layersRef = useRef<{ left: EyeLayer; right: EyeLayer } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = createRenderer('anaglyph-canvas2d');
    const layers = { left: new EyeLayer(), right: new EyeLayer() };
    rendererRef.current = renderer;
    layersRef.current = layers;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const render = () => {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, Math.round((w * 9) / 16));
      renderer.attach(canvas, w, h, dpr);
      layers.left.resize(w, h, dpr);
      layers.right.resize(w, h, dpr);
      draw(layers.left.begin(), layers.right.begin(), w, h);
      renderer.composite({ left: layers.left.canvas, right: layers.right.canvas }, options);
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      renderer.dispose();
    };
  }, [options, draw]);

  return (
    <canvas
      ref={ref}
      className="calib-canvas"
      data-testid={testId}
      role="img"
      aria-label="calibration pattern"
    />
  );
}
