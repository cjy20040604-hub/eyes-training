/** requestAnimationFrame loop with stable delta time, pause/resume and visibility handling. */
export type FrameCallback = (dtMs: number, nowMs: number) => void;

export class FrameLoop {
  private rafId: number | null = null;
  private last = 0;
  private running = false;
  private readonly maxDt: number;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.pause();
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
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(this.maxDt, now - this.last);
      this.last = now;
      this.callback(dt, now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  dispose(): void {
    this.pause();
  }
}
