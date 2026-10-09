/**
 * requestAnimationFrame loop with stable delta time, pause/resume and visibility handling.
 *
 * When the page is hidden (window minimised, tab switched) the loop pauses itself and
 * resumes automatically when the page becomes visible again. An explicit pause() is not
 * undone by visibility changes. The first frame after any (re)start uses dt = 0, so a long
 * absence never produces one giant time step.
 */
export type FrameCallback = (dtMs: number, nowMs: number) => void;

export class FrameLoop {
  private rafId: number | null = null;
  private last = 0;
  private running = false;
  private autoPaused = false;
  private listening = false;
  private readonly maxDt: number;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (this.running) {
        this.stopFrames();
        this.autoPaused = true;
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      this.startFrames();
    }
  };

  constructor(
    private readonly callback: FrameCallback,
    options: { maxDtMs?: number } = {},
  ) {
    this.maxDt = options.maxDtMs ?? 100;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (!this.listening) {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
    this.autoPaused = false;
    if (document.visibilityState === 'hidden') {
      this.autoPaused = true;
      return;
    }
    this.startFrames();
  }

  pause(): void {
    this.autoPaused = false;
    this.stopFrames();
  }

  dispose(): void {
    this.pause();
    if (this.listening) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.listening = false;
    }
  }

  private startFrames(): void {
    if (this.running) return;
    this.running = true;
    let first = true;
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = first ? 0 : Math.min(this.maxDt, Math.max(0, now - this.last));
      first = false;
      this.last = now;
      this.callback(dt, now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopFrames(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
