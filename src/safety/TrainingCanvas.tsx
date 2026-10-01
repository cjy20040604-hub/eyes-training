import { useEffect, useRef } from 'react';
import type { CalibrationProfile, SessionEvent } from '../data/schema';
import {
  FlashDetector,
  FrameSampler,
  flashAreaThresholdPx2,
  type FlashReport,
} from '../engine/flashDetector';
import { FrameLoop } from '../engine/frameLoop';
import {
  EyeLayer,
  createRenderer,
  type RenderOptions,
  type RendererId,
  type StereoRenderer,
} from '../engine/renderer';
import { TransitionGuard } from '../engine/transitionGuard';
import { degreesToPx, type ScreenGeometry } from '../engine/units';
import type { HudState, ModuleDefinition, ModuleInstance } from '../modules/types';

export interface TrainingCanvasProps {
  def: ModuleDefinition;
  calibration: CalibrationProfile;
  rendererId: RendererId;
  intensityValue: number;
  gameDifficulty: number;
  reducedMotion: boolean;
  cyclotorsionEnabled: boolean;
  /** When false the loop is paused (breaks, overlays, stop). */
  running: boolean;
  onHud: (hud: HudState) => void;
  onFlash: (report: FlashReport) => void;
  onEvent: (type: SessionEvent['type'], data?: SessionEvent['data']) => void;
  /** Receives a getter for the module's metrics. */
  metricsRef: React.MutableRefObject<(() => Record<string, number>) | null>;
}

export function baseRenderOptions(
  calibration: CalibrationProfile,
  cyclotorsionEnabled: boolean,
): RenderOptions {
  const rot = (t: { dx: number; dy: number; rotationDeg: number }) => ({
    ...t,
    rotationDeg: cyclotorsionEnabled ? t.rotationDeg : 0,
  });
  return {
    transforms: { left: rot(calibration.offset.left), right: rot(calibration.offset.right) },
    channels: calibration.channels,
    contrast: { left: 1, right: 1 },
    backgroundGray: calibration.backgroundGray,
  };
}

/**
 * Hosts the renderer, eye layers, frame loop, module instance, input handling and the
 * flash detector. The DOM around it (HUD, STOP button) is rendered by TrainingShell.
 */
export function TrainingCanvas(props: TrainingCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(props.running);
  const propsRef = useRef(props);
  propsRef.current = props;
  runningRef.current = props.running;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const p = propsRef.current;
    const geometry: ScreenGeometry = {
      distanceM: p.calibration.viewingDistanceCm / 100,
      ppi: p.calibration.device.ppi,
    };
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    let width = Math.max(1, wrap.clientWidth);
    let height = Math.max(1, wrap.clientHeight);

    let renderer: StereoRenderer;
    try {
      renderer = createRenderer(p.rendererId);
      if (!renderer.supported) renderer = createRenderer('anaglyph-canvas2d');
      renderer.attach(canvas, width, height, dpr);
    } catch {
      renderer = createRenderer('anaglyph-canvas2d');
      renderer.attach(canvas, width, height, dpr);
    }
    const layers = { left: new EyeLayer(), right: new EyeLayer() };
    layers.left.resize(width, height, dpr);
    layers.right.resize(width, height, dpr);

    const guard = new TransitionGuard();
    const sampler = new FrameSampler(64, 36);
    const tenDeg = degreesToPx(10, geometry);
    const makeDetector = () =>
      new FlashDetector({
        gridWidth: 64,
        gridHeight: 36,
        frameWidthPx: width,
        frameHeightPx: height,
        areaThresholdPx2: flashAreaThresholdPx2(tenDeg),
      });
    let detector = makeDetector();

    const module: ModuleInstance = p.def.create({
      calibration: p.calibration,
      geometry,
      intensityValue: p.intensityValue,
      gameDifficulty: p.gameDifficulty,
      guard,
      reducedMotion: p.reducedMotion,
      width,
      height,
      emit: (type, data) => propsRef.current.onEvent(type, data),
      random: Math.random,
    });
    p.metricsRef.current = () => module.metrics();
    const base = baseRenderOptions(p.calibration, p.cyclotorsionEnabled);

    let started = false;
    let lastFlashLevel: 'ok' | 'warn' | 'danger' = 'ok';
    let hudTimer = 0;
    const loop = new FrameLoop((dt, now) => {
      if (!runningRef.current) return;
      if (!started) {
        module.start(now);
        started = true;
      }
      module.update(dt, now);
      module.draw(layers);
      renderer.composite(
        { left: layers.left.canvas, right: layers.right.canvas },
        module.renderOverrides(base),
      );
      // Photosensitivity watch on what is actually displayed.
      try {
        const report = detector.analyzeFrame(sampler.sample(canvas), now);
        if (report.level !== lastFlashLevel) {
          lastFlashLevel = report.level;
          if (report.level !== 'ok') propsRef.current.onFlash(report);
        }
      } catch {
        // Tainted canvas: cannot verify. Treat as danger.
        propsRef.current.onFlash({
          level: 'danger',
          flashRate: 0,
          redFlashRate: 0,
          flashingAreaFraction: 0,
          timestampMs: now,
        });
      }
      hudTimer += dt;
      if (hudTimer > 200) {
        hudTimer = 0;
        propsRef.current.onHud(module.hud());
      }
    });

    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        module.input({ type: 'action' });
        return;
      }
      keys.add(e.key);
      const dx =
        (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
      const dy =
        (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
      if (dx || dy) {
        e.preventDefault();
        module.input({ type: 'move', dx, dy });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key);
    const pointer = (e: PointerEvent, down: boolean) => {
      const rect = canvas.getBoundingClientRect();
      module.input({ type: 'pointer', x: e.clientX - rect.left, y: e.clientY - rect.top, down });
    };
    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointer(e, true);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons > 0) pointer(e, true);
    };
    const onPointerUp = (e: PointerEvent) => pointer(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const ro = new ResizeObserver(() => {
      width = Math.max(1, wrap.clientWidth);
      height = Math.max(1, wrap.clientHeight);
      renderer.resize(width, height, dpr);
      layers.left.resize(width, height, dpr);
      layers.right.resize(width, height, dpr);
      module.resize(width, height);
      detector = makeDetector();
    });
    ro.observe(wrap);

    // Gamepad polling (optional input path).
    let gpTimer: number | null = null;
    if ('getGamepads' in navigator) {
      gpTimer = window.setInterval(() => {
        const gp = navigator.getGamepads?.()[0];
        if (!gp || !runningRef.current) return;
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2) module.input({ type: 'move', dx: ax, dy: ay });
        if (gp.buttons[0]?.pressed) module.input({ type: 'action' });
      }, 50);
    }

    loop.start();
    return () => {
      loop.dispose();
      ro.disconnect();
      if (gpTimer !== null) clearInterval(gpTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      module.stop();
      renderer.dispose();
      p.metricsRef.current = null;
    };
    // The module is created once per mount; parameter changes require a remount (new session).
  }, []);

  return (
    <div className="training-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} data-testid="training-canvas" aria-label="training stimulus" role="img" />
    </div>
  );
}
