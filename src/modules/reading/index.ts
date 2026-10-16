import i18next from 'i18next';
import type { CalibrationProfile, IntensityTier } from '../../data/schema';
import type { EyeLayer, RenderOptions } from '../../engine/renderer';
import { drawFusionFrame, grayCss, stimulusArea } from '../common';
import type {
  HudState,
  IntensityMap,
  ModuleDefinition,
  ModuleInput,
  ModuleInstance,
  ModuleRuntimeContext,
  Performance,
} from '../types';

/**
 * Dichoptic reading — anti-suppression while doing something ordinary.
 *
 * A short page of text is split between the eyes: alternate words (Chinese: alternate
 * characters) go to the left and the right eye, so the text only reads as a whole when both
 * eyes take part. The weak (left) eye keeps full contrast; the dominant eye's contrast is
 * lowered, as in L1. Both eyes see the frame and faint reading lines, which help fusion.
 * If words keep disappearing, that eye is being suppressed: Arrow Down reports it.
 *
 * Space / Arrow Right / tapping the right half = next page; Arrow Left / left half = back.
 * The texts are short original passages written for this app.
 *
 * Visual difficulty = dominant-eye contrast. Game difficulty = text size (smaller is harder).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

const intensity: IntensityMap = {
  metric: 'dominantContrastRatio',
  unit: '',
  valueForTier(tier: IntensityTier, calibration: CalibrationProfile): number {
    const b = calibration.contrastBalance.balanceRatio;
    if (tier === 'low') return round2(b);
    if (tier === 'medium') return round2(b + (1 - b) * 0.25);
    return round2(b + (1 - b) * 0.5);
  },
  bounds: (calibration) => ({ min: 0.05, max: Math.min(1, calibration.contrastBalance.balanceRatio + 0.6) }),
  maxStepPerSession: 0.05,
  stepBack: 0.1,
  harderDirection: 1,
  requiresClinician: false,
  format: (v) => `${Math.round(v * 100)}%`,
};

export const PASSAGE_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;

/** Split text into reading units: words (space-separated scripts) or single CJK characters. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (/\p{Script=Han}/u.test(word)) {
      // CJK: one token per character; punctuation stays with the character before it.
      for (const ch of Array.from(word)) {
        if (tokens.length && /^[\p{P}\p{S}]$/u.test(ch)) tokens[tokens.length - 1] += ch;
        else tokens.push(ch);
      }
    } else {
      tokens.push(word);
    }
  }
  return tokens;
}

export interface PlacedToken {
  text: string;
  x: number;
  y: number;
  eye: 'left' | 'right';
}

/**
 * Lay tokens out in lines inside `width`, and split them into pages of `linesPerPage`.
 * Tokens alternate between the eyes, counting across the whole passage.
 */
export function layoutPages(
  tokens: string[],
  measure: (s: string) => number,
  opts: { width: number; lineHeight: number; linesPerPage: number; spaced: boolean },
): PlacedToken[][] {
  const gap = opts.spaced ? measure(' ') : measure(String.fromCharCode(0x2009)); // thin space
  const pages: PlacedToken[][] = [];
  let page: PlacedToken[] = [];
  let x = 0;
  let line = 0;
  tokens.forEach((text, i) => {
    const w = measure(text);
    if (x > 0 && x + w > opts.width) {
      x = 0;
      line += 1;
      if (line >= opts.linesPerPage) {
        pages.push(page);
        page = [];
        line = 0;
      }
    }
    page.push({ text, x, y: line * opts.lineHeight, eye: i % 2 === 0 ? 'left' : 'right' });
    x += w + gap;
  });
  if (page.length) pages.push(page);
  return pages;
}

export class ReadingInstance implements ModuleInstance {
  private pages: PlacedToken[][] = [];
  private page = 0;
  private passage = 0;
  private now = 0;
  private pageShownAt = 0;
  private pagesRead = 0;
  private wordsRead = 0;
  private missing = 0;
  private pageTimes: number[] = [];
  private fontPx = 24;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private promptKey = 'modules.reading.prompt.read';
  private missingAt = -Infinity;
  private readonly measureCtx: CanvasRenderingContext2D | null;

  constructor(private ctx: ModuleRuntimeContext) {
    this.passage = Math.floor(ctx.random() * PASSAGE_KEYS.length);
    this.measureCtx = document.createElement('canvas').getContext('2d');
    this.layout();
  }

  private font(): string {
    return `${this.fontPx}px Georgia, "Noto Serif SC", "Songti SC", serif`;
  }

  private layout(): void {
    const a = stimulusArea(this.ctx);
    const g = this.ctx.gameDifficulty;
    this.fontPx = Math.round(Math.max(16, Math.min(34, this.ctx.height * 0.05)) * (1 - (g - 1) * 0.06));
    const lineHeight = Math.round(this.fontPx * 1.75);
    // Inside the shared fusion frame (which sits 24 px outside the stimulus area).
    const w = a.halfW * 2 + 16;
    const h = a.halfH * 2 + 16;
    this.box = { x: a.cx - w / 2, y: a.cy - h / 2, w, h };
    const key = PASSAGE_KEYS[this.passage % PASSAGE_KEYS.length];
    const text = i18next.t(`modules.reading.passages.${key}`);
    const m = this.measureCtx;
    if (m) m.font = this.font();
    const measure = (s: string) => (m ? m.measureText(s).width : s.length * this.fontPx * 0.55);
    this.pages = layoutPages(tokenize(text), measure, {
      width: w,
      lineHeight,
      linesPerPage: Math.max(2, Math.floor(h / lineHeight)),
      spaced: !/\p{Script=Han}/u.test(text),
    });
    this.page = Math.min(this.page, Math.max(0, this.pages.length - 1));
  }

  start(nowMs: number): void {
    this.now = nowMs;
    this.pageShownAt = nowMs;
  }

  update(_dtMs: number, nowMs: number): void {
    this.now = nowMs;
    this.promptKey =
      nowMs - this.missingAt < 4000
        ? 'modules.reading.prompt.missing'
        : this.page === this.pages.length - 1
          ? 'modules.reading.prompt.last'
          : 'modules.reading.prompt.read';
  }

  private turn(delta: 1 | -1): void {
    // A page change is a large-area change: keep it inside the transition guard.
    if (!this.ctx.guard.request(this.now, 'reading-page')) return;
    if (delta === 1) {
      this.pagesRead += 1;
      this.wordsRead += this.pages[this.page]?.length ?? 0;
      this.pageTimes.push(this.now - this.pageShownAt);
      if (this.page >= this.pages.length - 1) {
        this.passage += 1;
        this.page = 0;
        this.layout();
      } else {
        this.page += 1;
      }
    } else if (this.page > 0) {
      this.page -= 1;
    }
    this.pageShownAt = this.now;
  }

  draw(layers: { left: EyeLayer; right: EyeLayer }): void {
    const lineHeight = Math.round(this.fontPx * 1.75);
    const tokens = this.pages[this.page] ?? [];
    const lines = tokens.reduce((n, t) => Math.max(n, t.y / lineHeight + 1), 0);
    for (const eye of ['left', 'right'] as const) {
      const c = layers[eye].begin();
      drawFusionFrame(c, this.ctx, 0.35);
      // Faint reading lines, seen by both eyes.
      c.strokeStyle = grayCss(0.18);
      c.lineWidth = 1;
      for (let i = 0; i < lines; i++) {
        const y = this.box.y + i * lineHeight + this.fontPx * 1.15;
        c.beginPath();
        c.moveTo(this.box.x, y);
        c.lineTo(this.box.x + this.box.w, y);
        c.stroke();
      }
      c.font = this.font();
      c.textBaseline = 'alphabetic';
      c.fillStyle = grayCss(1);
      for (const t of tokens) {
        if (t.eye !== eye) continue;
        c.fillText(t.text, this.box.x + t.x, this.box.y + t.y + this.fontPx);
      }
    }
  }

  input(input: ModuleInput): void {
    if (input.type === 'action') this.turn(1);
    else if (input.type === 'direction') {
      if (input.dx > 0) this.turn(1);
      else if (input.dx < 0) this.turn(-1);
      else if (input.dy > 0) {
        this.missing += 1;
        this.missingAt = this.now;
        this.ctx.emit('probe', { reading: 'words-missing', page: this.pagesRead + 1 });
      }
    } else if (input.type === 'pointer' && input.down) {
      this.turn(input.x >= this.ctx.width / 2 ? 1 : -1);
    }
  }

  resize(width: number, height: number): void {
    this.ctx = { ...this.ctx, width, height };
    this.layout();
  }

  renderOverrides(base: RenderOptions): RenderOptions {
    const dominant = this.ctx.calibration.contrastBalance.dominantEye;
    const weak = dominant === 'right' ? 'left' : 'right';
    return { ...base, contrast: { ...base.contrast, [dominant]: this.ctx.intensityValue, [weak]: 1 } };
  }

  hud(): HudState {
    return {
      promptKey: this.promptKey,
      promptParams: { page: this.page + 1, pages: this.pages.length },
      score: this.pagesRead,
      roundProgress: this.pages.length > 1 ? this.page / (this.pages.length - 1) : null,
    };
  }

  metrics(): Record<string, number> {
    const mean = this.pageTimes.length
      ? this.pageTimes.reduce((a, b) => a + b, 0) / this.pageTimes.length
      : 0;
    return {
      pagesRead: this.pagesRead,
      wordsRead: this.wordsRead,
      missingReports: this.missing,
      secondsPerPage: Math.round(mean / 100) / 10,
    };
  }

  stop(): void {}
}

/** Good: at least three pages with at most one "words missing" report. Poor: frequent reports. */
export function assessReading(metrics: Record<string, number>, _minutes: number): Performance {
  const pages = metrics['pagesRead'] ?? 0;
  const missing = metrics['missingReports'] ?? 0;
  if (missing >= 4) return 'poor';
  if (pages >= 3 && missing <= 1) return 'good';
  return 'ok';
}

export const readingModule: ModuleDefinition = {
  id: 'reading',
  code: 'R',
  minMinutes: 3,
  maxMinutes: 10,
  defaultMinutes: 5,
  intensity,
  implemented: true,
  requiresInput: true,
  // Reading a page can take well over a minute without a key press.
  idlePauseMs: 150_000,
  create: (ctx) => new ReadingInstance(ctx),
  assess: assessReading,
};
