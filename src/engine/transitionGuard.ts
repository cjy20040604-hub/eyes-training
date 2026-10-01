/**
 * Prevention layer for photosensitive safety. Modules MUST request permission before
 * changing a stimulus in a way that changes luminance noticeably. The guard refuses any
 * transition whose leading edge would be closer than MIN_TRANSITION_INTERVAL_MS to the
 * previous one for the same key, and never allows more than MAX_TRANSITIONS_PER_SECOND
 * within any sliding one-second window. This keeps our own animations at or below the
 * WCAG 2.3.1 / ITU-R BT.1702 limit of 3 flashes per second (a flash is a pair of
 * opposing transitions, so 6 transitions/s is the theoretical ceiling; we cap at 3
 * transitions/s for a large safety margin).
 */
export const MIN_TRANSITION_INTERVAL_MS = 334;
export const MAX_TRANSITIONS_PER_SECOND = 3;

export class TransitionGuard {
  private readonly history = new Map<string, number[]>();

  constructor(
    private readonly minIntervalMs: number = MIN_TRANSITION_INTERVAL_MS,
    private readonly maxPerSecond: number = MAX_TRANSITIONS_PER_SECOND,
  ) {}

  /** Returns true if the transition is allowed (and records it); false if it must be skipped. */
  request(nowMs: number, key = 'default'): boolean {
    const times = (this.history.get(key) ?? []).filter((t) => nowMs - t < 1000);
    const last = times[times.length - 1];
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      this.history.set(key, times);
      return false;
    }
    if (times.length >= this.maxPerSecond) {
      this.history.set(key, times);
      return false;
    }
    times.push(nowMs);
    this.history.set(key, times);
    return true;
  }

  /** Milliseconds until the next transition for `key` would be allowed. */
  waitMs(nowMs: number, key = 'default'): number {
    const times = (this.history.get(key) ?? []).filter((t) => nowMs - t < 1000);
    const last = times[times.length - 1];
    let wait = 0;
    if (last !== undefined) wait = Math.max(wait, this.minIntervalMs - (nowMs - last));
    if (times.length >= this.maxPerSecond) {
      const oldest = times[0];
      if (oldest !== undefined) wait = Math.max(wait, 1000 - (nowMs - oldest));
    }
    return Math.max(0, wait);
  }

  reset(): void {
    this.history.clear();
  }
}
