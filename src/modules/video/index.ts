import type { IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { grayCss, stimulusArea } from '../common';
import type {
  HudState,
  IntensityMap,
  ModuleDefinition,
  ModuleInput,
  ModuleInstance,
  ModuleRuntimeContext,
  Performance,
} from '../types';
import { SCENE_IDS, SceneSource, type SceneId } from './scenes';
import { VideoSetup } from './VideoSetup';

/**
 * Dichoptic video — watch your own video with a balanced binocular input.
 *
 * Inspired by dichoptic movie viewing (Luminopia, AmblyoBye); implemented independently:
 *  - Both eyes see the movie in grayscale (anaglyph channels cannot carry colour per eye).
 *  - The weak (left) eye keeps full contrast. The dominant (right) eye's contrast is lowered
 *    by the dichoptic strength.
 *  - Soft, slowly drifting complementary masks: where one eye's mask removes part of the
 *    picture, the other eye still sees it, so the full picture needs both eyes.
 *  - Overall brightness is capped (BRIGHTNESS_CAP) and the session's flash detector watches
 *    every rendered frame; the video pauses with any break, overlay or STOP.
 *  - Besides the user's own files, built-in calm scenes (scenes.ts) are always available.
 *
 * Visual difficulty = dichoptic strength (0..0.9).
 */

export const BRIGHTNESS_CAP = 0.85;
const MASK_W = 32;
const MASK_H = 18;

const intensity: IntensityMap = {
  metric: 'dichopticStrength',
  unit: '',
  valueForTier: (tier: IntensityTier) => (tier === 'low' ? 0.3 : tier === 'medium' ? 0.5 : 0.7),
  bounds: () => ({ min: 0, max: 0.9 }),
  maxStepPerSession: 0.05,
  stepBack: 0.1,
  harderDirection: 1,
  requiresClinician: false,
  format: (v) => `${Math.round(v * 100)}%`,
};

/** Smooth value noise in 0..1 on a low-resolution grid, evaluated at time t (seconds). */
export function maskValue(gx: number, gy: number, t: number, seed: number): number {
  const a = Math.sin(gx * 0.55 + t * 0.21 + seed) + Math.sin(gy * 0.7 - t * 0.17 + seed * 1.7);
  const b = Math.sin((gx + gy) * 0.33 + t * 0.13 + seed * 0.3);
  return Math.min(1, Math.max(0, 0.5 + (a + b) / 6));
}

/** How much of each eye's picture survives at mask value m with strength s (0..1). */
export function eyeVisibility(m: number, s: number): { left: number; right: number } {
  // The left (weak) eye loses less than the right; together they always cover the picture.
  return { left: 1 - s * 0.6 * (1 - m), right: 1 - s * m };
}

export class VideoInstance implements ModuleInstance {
  readonly video: HTMLVideoElement;
  /** A built-in scene instead of a video file. */
  readonly scene: SceneSource | null;
  private readonly maskLeft: HTMLCanvasElement;
  private readonly maskRight: HTMLCanvasElement;
  private readonly seed: number;
  private t = 0;
  private watchedMs = 0;
  private paused = false;
  private started = false;
  private errorKey: string | null = null;
  private needsTap = false;
  private ended = false;

  constructor(private ctx: ModuleRuntimeContext) {
    const v = document.createElement('video');
    const kind = String(ctx.config['kind'] ?? 'file');
    const sceneId = String(ctx.config['scene'] ?? '');
    this.scene =
      kind === 'scene' && (SCENE_IDS as readonly string[]).includes(sceneId)
        ? new SceneSource(sceneId as SceneId, Math.floor(ctx.random() * 1000))
        : null;
    if (kind === 'url') v.crossOrigin = 'anonymous';
    if (!this.scene) v.src = String(ctx.config['src'] ?? '');
    v.loop = ctx.config['loop'] !== false;
    v.muted = ctx.config['muted'] === true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('error', () => {
      this.errorKey = 'modules.video.prompt.error';
    });
    v.addEventListener('ended', () => {
      this.ended = true;
    });
    this.video = v;
    this.maskLeft = document.createElement('canvas');
    this.maskRight = document.createElement('canvas');
    for (const c of [this.maskLeft, this.maskRight]) {
      c.width = MASK_W;
      c.height = MASK_H;
    }
    this.seed = ctx.random() * 10;
  }

  private play(): void {
    if (this.paused || this.ended || this.scene) return;
    const p = this.video.play();
    if (p && typeof p.then === 'function') {
      p.then(
        () => {
          this.needsTap = false;
        },
        () => {
          // Autoplay with sound was blocked: ask for a tap/key to start.
          this.needsTap = true;
        },
      );
    }
  }

  start(_nowMs: number): void {
    this.started = true;
    this.play();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.video.pause();
    else if (this.started) this.play();
  }

  update(dtMs: number, _nowMs: number): void {
    this.t += dtMs / 1000;
    if (this.scene) {
      if (!this.paused) {
        this.scene.update(dtMs);
        this.watchedMs += dtMs;
      }
    } else if (!this.video.paused && !this.video.ended && this.video.readyState >= 2) this.watchedMs += dtMs;
    this.updateMasks();
  }

  private updateMasks(): void {
    const s = Math.max(0, Math.min(0.9, this.ctx.intensityValue));
    const lc = this.maskLeft.getContext('2d');
    const rc = this.maskRight.getContext('2d');
    if (!lc || !rc) return;
    const li = lc.createImageData(MASK_W, MASK_H);
    const ri = rc.createImageData(MASK_W, MASK_H);
    for (let y = 0; y < MASK_H; y++) {
      for (let x = 0; x < MASK_W; x++) {
        const m = maskValue(x, y, this.t, this.seed);
        const vis = eyeVisibility(m, s);
        const i = (y * MASK_W + x) * 4;
        // Alpha = how much of the picture to REMOVE (used with destination-out).
        li.data[i + 3] = Math.round((1 - vis.left) * 255);
        ri.data[i + 3] = Math.round((1 - vis.right) * 255);
      }
    }
    lc.putImageData(li, 0, 0);
    rc.putImageData(ri, 0, 0);
  }

  private fitRect(): { x: number; y: number; w: number; h: number } {
    const a = stimulusArea(this.ctx);
    // Video may use a little more than the game area, still near primary gaze.
    const maxW = a.halfW * 2 * 1.25;
    const maxH = a.halfH * 2 * 1.25;
    const vw = this.scene ? this.scene.width : this.video.videoWidth || 16;
    const vh = this.scene ? this.scene.height : this.video.videoHeight || 9;
    const k = Math.min(maxW / vw, maxH / vh);
    const w = vw * k;
    const h = vh * k;
    return { x: a.cx - w / 2, y: a.cy - h / 2, w, h };
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const l = layers.left.begin();
    const r = layers.right.begin();
    const ready = this.scene ? true : this.video.readyState >= 2 && !this.errorKey;
    const source: CanvasImageSource = this.scene ? this.scene.canvas : this.video;
    const f = this.fitRect();
    for (const [c, mask] of [
      [l, this.maskLeft],
      [r, this.maskRight],
    ] as const) {
      if (!ready) continue;
      c.save();
      c.filter = 'grayscale(1)';
      c.drawImage(source, f.x, f.y, f.w, f.h);
      c.filter = 'none';
      c.globalCompositeOperation = 'destination-out';
      c.imageSmoothingEnabled = true;
      c.drawImage(mask, f.x, f.y, f.w, f.h);
      c.restore();
    }
    // A thin frame both eyes share helps the two pictures lock together.
    for (const c of [l, r]) {
      c.strokeStyle = grayCss(0.35);
      c.lineWidth = 2;
      c.strokeRect(f.x - 6, f.y - 6, f.w + 12, f.h + 12);
    }
  }

  input(input: ModuleInput): void {
    if ((input.type === 'action' || (input.type === 'pointer' && input.down)) && this.needsTap) {
      this.play();
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    const s = Math.max(0, Math.min(0.9, this.ctx.intensityValue));
    const dominant = this.ctx.calibration.contrastBalance.dominantEye;
    const weak = dominant === 'right' ? 'left' : 'right';
    return {
      ...base,
      contrast: {
        ...base.contrast,
        [weak]: BRIGHTNESS_CAP,
        [dominant]: BRIGHTNESS_CAP * (1 - 0.5 * s),
      },
    };
  }

  hud(): HudState {
    const key = this.errorKey
      ? this.errorKey
      : this.needsTap
        ? 'modules.video.prompt.tapToPlay'
        : this.ended
          ? 'modules.video.prompt.ended'
          : !this.scene && this.video.readyState < 2
            ? 'modules.video.prompt.loading'
            : 'modules.video.prompt.watching';
    return {
      promptKey: key,
      promptParams: { name: String(this.ctx.config['name'] ?? '') },
      score: Math.floor(this.watchedMs / 60000),
      roundProgress: null,
    };
  }

  metrics(): Record<string, number> {
    return {
      watchedSeconds: Math.round(this.watchedMs / 1000),
      videoSeconds: !this.scene && Number.isFinite(this.video.duration) ? Math.round(this.video.duration) : 0,
    };
  }

  stop(): void {
    this.video.pause();
    const src = String(this.ctx.config['src'] ?? '');
    this.video.removeAttribute('src');
    this.video.load();
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }
}

/** Good: watched for at least 80% of the session. Poor: under 30% (playback problems). */
export function assessVideo(metrics: Record<string, number>, minutes: number): Performance {
  const watched = (metrics['watchedSeconds'] ?? 0) / 60;
  if (minutes <= 0) return 'ok';
  const share = watched / minutes;
  if (share >= 0.8) return 'good';
  if (share < 0.3) return 'poor';
  return 'ok';
}

export const videoModule: ModuleDefinition = {
  id: 'video',
  code: 'V',
  minMinutes: 5,
  maxMinutes: 15,
  defaultMinutes: 10,
  intensity,
  implemented: true,
  requiresInput: false,
  setup: VideoSetup,
  create: (ctx) => new VideoInstance(ctx),
  assess: assessVideo,
};
