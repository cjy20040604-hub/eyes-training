/**
 * Fusional vergence ramp: smooth base-out (convergence) and base-in (divergence) demand
 * with break / recovery recording.
 *
 *  rest ──► ramp-up ──(Space: "I see two" = BREAK)──► ramp-down ──(Space: "single again"
 *                 │                                        ▲          = RECOVERY)──► rest
 *                 └──(reached the cap, no break)──► hold ───┘
 *
 * Safety:
 *  - demand never exceeds the session cap, and never exceeds conservative ceilings well
 *    below normal adult amplitudes (AAO: near convergence break ~20–25Δ, divergence ~12Δ);
 *  - divergence (base-in) is capped lower than convergence;
 *  - vertical demand is always zero;
 *  - a break immediately reverses the ramp.
 */

export type VergenceDirection = 'BO' | 'BI';
export type VergencePhase = 'rest' | 'ramp-up' | 'hold' | 'ramp-down';

/** Absolute ceilings, in prism diopters. */
export const VERGENCE_CEILING = { BO: 12, BI: 6 } as const;

export interface VergenceRound {
  direction: VergenceDirection;
  /** Demand at the reported break, or null if the cap was reached without a break. */
  breakDelta: number | null;
  /** Demand at the reported recovery, or 0 if the ramp reached zero first. */
  recoveryDelta: number | null;
  maxDelta: number;
}

export interface VergenceConfig {
  /** Session cap in Δ (the module's intensity value). */
  capDelta: number;
  rampUpPerSec: number;
  rampDownPerSec: number;
  restMs: number;
  holdMs: number;
}

export class VergenceRamp {
  phase: VergencePhase = 'rest';
  direction: VergenceDirection = 'BO';
  demand = 0;
  readonly rounds: VergenceRound[] = [];
  private phaseMs = 0;
  private current: VergenceRound | null = null;

  constructor(private readonly cfg: VergenceConfig) {}

  /** Cap for the current direction. */
  get cap(): number {
    const ceiling = VERGENCE_CEILING[this.direction];
    return Math.max(0, Math.min(this.cfg.capDelta, ceiling));
  }

  /** Signed horizontal demand: + = base-out (convergence), − = base-in. */
  get signedDemand(): number {
    return this.direction === 'BO' ? this.demand : -this.demand;
  }

  update(dtMs: number): void {
    this.phaseMs += dtMs;
    const dt = dtMs / 1000;
    switch (this.phase) {
      case 'rest':
        this.demand = 0;
        if (this.phaseMs >= this.cfg.restMs) this.enter('ramp-up');
        break;
      case 'ramp-up':
        this.demand = Math.min(this.cap, this.demand + this.cfg.rampUpPerSec * dt);
        if (this.current) this.current.maxDelta = Math.max(this.current.maxDelta, this.demand);
        if (this.demand >= this.cap - 1e-9) this.enter('hold');
        break;
      case 'hold':
        if (this.phaseMs >= this.cfg.holdMs) this.enter('ramp-down');
        break;
      case 'ramp-down':
        this.demand = Math.max(0, this.demand - this.cfg.rampDownPerSec * dt);
        if (this.demand <= 0) {
          if (this.current && this.current.recoveryDelta === null) this.current.recoveryDelta = 0;
          this.finishRound();
        }
        break;
    }
  }

  /** The user's single key: "I see two" while ramping up, "single again" while ramping down. */
  report(): 'break' | 'recovery' | null {
    if (this.phase === 'ramp-up' && this.current) {
      this.current.breakDelta = round2(this.demand);
      this.enter('ramp-down');
      return 'break';
    }
    if (this.phase === 'ramp-down' && this.current && this.current.breakDelta !== null) {
      this.current.recoveryDelta = round2(this.demand);
      this.finishRound();
      return 'recovery';
    }
    return null;
  }

  private enter(phase: VergencePhase): void {
    this.phase = phase;
    this.phaseMs = 0;
    if (phase === 'ramp-up') {
      this.current = { direction: this.direction, breakDelta: null, recoveryDelta: null, maxDelta: 0 };
    }
  }

  private finishRound(): void {
    if (this.current) {
      this.current.maxDelta = round2(this.current.maxDelta);
      this.rounds.push(this.current);
    }
    this.current = null;
    this.demand = 0;
    this.direction = this.direction === 'BO' ? 'BI' : 'BO';
    this.enter('rest');
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Mean of the non-null values, or null if there are none. */
export function meanOf(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

export function summarizeRounds(rounds: VergenceRound[]): Record<string, number> {
  const out: Record<string, number> = { rounds: rounds.length };
  for (const dir of ['BO', 'BI'] as const) {
    const r = rounds.filter((x) => x.direction === dir);
    const brk = meanOf(r.map((x) => x.breakDelta));
    const rec = meanOf(r.filter((x) => x.breakDelta !== null).map((x) => x.recoveryDelta));
    if (brk !== null) out[`meanBreak${dir}`] = brk;
    if (rec !== null) out[`meanRecovery${dir}`] = rec;
    out[`noBreak${dir}`] = r.filter((x) => x.breakDelta === null).length;
    if (r.length) out[`maxDemand${dir}`] = Math.max(...r.map((x) => x.maxDelta));
  }
  return out;
}
