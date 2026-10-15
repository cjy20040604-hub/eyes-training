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
import { transformToMatrix } from '../engine/affine';
import { TransitionGuard } from '../engine/transitionGuard';
import { degreesToPx, type ScreenGeometry } from '../engine/units';
import type { HudState, ModuleConfig, ModuleDefinition, ModuleInstance } from '../modules/types';

/** Page coordinates of a module's key objects, as exposed to end-to-end tests. */
export type ProbeSnapshot = Record<string, { x: number; y: number; eye: 'left' | 'right' }>;
type ProbeWindow = Window & { __bvProbe?: () => ProbeSnapshot };

/** Without any input for this long, an input-driven module pauses (idle time is not training). */
export const IDLE_PAUSE_MS = 60_000;

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
  /** Set to performance.now() on every drawn frame, so the session timer can tell a frozen stimulus. */
  frameClockRef?: React.MutableRefObject<number>;
  /** Per-session module settings from the setup step (e.g. the chosen video). */
  config?: ModuleConfig;
  /** Called once when an input-driven module has had no input for IDLE_PAUSE_MS. */
  onIdle?: () => void;
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
  const moduleRef = useRef<ModuleInstance | null>(null);
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
      dpr,
      config: p.config ?? {},
      emit: (type, data) => propsRef.current.onEvent(type, data),
      random: Math.random,
    });
    moduleRef.current = module;
    p.metricsRef.current = () => module.metrics();
    const base = baseRenderOptions(p.calibration, p.cyclotorsionEnabled);

    let started = false;
    let lastFlashLevel: 'ok' | 'warn' | 'danger' = 'ok';
    let hudTimer = 0;
    let lastInputAt = performance.now();
    let idleReported = false;
    let wasRunning = true;
    const noteInput = () => {
      lastInputAt = performance.now();
      idleReported = false;
    };
    const loop = new FrameLoop((dt, now) => {
      if (!runningRef.current) {
        wasRunning = false;
        return;
      }
      if (!wasRunning) {
        // Resuming after a break or overlay: the idle clock starts again.
        wasRunning = true;
        noteInput();
      }
      if (p.def.requiresInput && !idleReported && performance.now() - lastInputAt > IDLE_PAUSE_MS) {
        idleReported = true;
        propsRef.current.onIdle?.();
      }
      if (!started) {
        module.start(now);
        started = true;
      }
      module.update(dt, now);
      module.draw(layers);
      if (propsRef.current.frameClockRef) propsRef.current.frameClockRef.current = performance.now();
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
        // Tainted canvas (e.g. a video without CORS): cannot verify. Treat as danger.
        propsRef.current.onFlash({
          level: 'danger',
          unverifiable: true,
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

    // ---- Keyboard: held keys -> direction (sent only when it changes) ----
    const held = new Set<string>();
    let lastDir = { dx: 0, dy: 0 };
    const sendDirection = (dx: number, dy: number) => {
      if (dx === lastDir.dx && dy === lastDir.dy) return;
      lastDir = { dx, dy };
      module.input({ type: 'direction', dx, dy });
    };
    const directionFromKeys = (slow: boolean) => {
      const has = (...k: string[]) => k.some((x) => held.has(x));
      const scale = slow ? 0.35 : 1;
      const dx = ((has('arrowright', 'd') ? 1 : 0) - (has('arrowleft', 'a') ? 1 : 0)) * scale;
      const dy = ((has('arrowdown', 's') ? 1 : 0) - (has('arrowup', 'w') ? 1 : 0)) * scale;
      sendDirection(dx, dy);
    };
    const MOVE_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!runningRef.current) return;
      noteInput();
      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'enter') {
        e.preventDefault();
        if (!e.repeat) module.input({ type: 'action' });
        return;
      }
      if (MOVE_KEYS.has(key)) {
        e.preventDefault();
        held.add(key);
      }
      directionFromKeys(e.shiftKey);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.key.toLowerCase());
      directionFromKeys(e.shiftKey);
    };
    const releaseAll = () => {
      held.clear();
      sendDirection(0, 0);
    };

    // ---- Pointer: a tap/click sets a target the object glides to; dragging updates it ----
    const pointerAt = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      module.input({ type: 'pointer', x: e.clientX - rect.left, y: e.clientY - rect.top, down: true });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!runningRef.current) return;
      noteInput();
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is optional.
      }
      pointerAt(e);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (runningRef.current && e.buttons > 0) pointerAt(e);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);

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

    // Gamepad polling (optional input path): left stick = direction, button A = action.
    let gpTimer: number | null = null;
    let gpWasPressed = false;
    let gpActive = false;
    if ('getGamepads' in navigator) {
      gpTimer = window.setInterval(() => {
        const gp = navigator.getGamepads?.()[0];
        if (!gp || !runningRef.current) return;
        const dead = (v: number) => (Math.abs(v) > 0.2 ? v : 0);
        const ax = dead(gp.axes[0] ?? 0);
        const ay = dead(gp.axes[1] ?? 0);
        if (ax || ay) {
          noteInput();
          gpActive = true;
          sendDirection(Math.round(ax * 10) / 10, Math.round(ay * 10) / 10);
        } else if (gpActive) {
          gpActive = false;
          sendDirection(0, 0);
        }
        const pressed = !!gp.buttons[0]?.pressed;
        if (pressed && !gpWasPressed) {
          noteInput();
          module.input({ type: 'action' });
        }
        gpWasPressed = pressed;
      }, 50);
    }

    // End-to-end test builds only (vite --mode e2e; removed from production builds): report
    // where the module's objects appear on the page, through the same per-eye transform the
    // anaglyph renderers use, so tests can aim without scanning pixels.
    if (import.meta.env.MODE === 'e2e') {
      (window as ProbeWindow).__bvProbe = () => {
        const rect = canvas.getBoundingClientRect();
        const opts = module.renderOverrides(base);
        const out: ProbeSnapshot = {};
        for (const [name, pt] of Object.entries(module.probe?.() ?? {})) {
          const m = transformToMatrix(opts.transforms[pt.eye], width / 2, height / 2);
          out[name] = {
            eye: pt.eye,
            x: rect.left + m[0] * pt.x + m[2] * pt.y + m[4],
            y: rect.top + m[1] * pt.x + m[3] * pt.y + m[5],
          };
        }
        return out;
      };
    }

    loop.start();
    return () => {
      if (import.meta.env.MODE === 'e2e') delete (window as ProbeWindow).__bvProbe;
      loop.dispose();
      ro.disconnect();
      if (gpTimer !== null) clearInterval(gpTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      module.stop();
      moduleRef.current = null;
      renderer.dispose();
      p.metricsRef.current = null;
    };
    // The module is created once per mount; parameter changes require a remount (new session).
  }, []);

  // Let the module pause its own media (e.g. the video) during breaks, overlays and STOP.
  useEffect(() => {
    moduleRef.current?.setPaused?.(!props.running);
  }, [props.running]);

  return (
    <div className="training-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} data-testid="training-canvas" aria-label="training stimulus" role="img" />
    </div>
  );
}
