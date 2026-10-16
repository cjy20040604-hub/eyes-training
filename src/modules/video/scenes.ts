import { mulberry32 } from '../../engine/random';

/**
 * Built-in calm scenes for the dichoptic video module, drawn live on a canvas, so there is
 * always something suitable to watch without downloading anything (and no copyright).
 * Everything moves slowly and the overall brightness never changes quickly: the scenes are
 * flash-free by construction (the session's flash detector still watches every frame).
 */

export const SCENE_IDS = ['aquarium', 'clouds', 'lanterns'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const SCENE_W = 640;
export const SCENE_H = 360;

const gray = (v: number, a = 1) => {
  const g = Math.round(255 * Math.max(0, Math.min(1, v)));
  return `rgba(${g},${g},${g},${a})`;
};

interface Mover {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}

export class SceneSource {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private t = 0;
  private readonly movers: Mover[];
  private readonly bubbles: Mover[];

  constructor(
    readonly id: SceneId,
    seed = 7,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCENE_W;
    this.canvas.height = SCENE_H;
    this.ctx = this.canvas.getContext('2d');
    const rnd = mulberry32(seed + SCENE_IDS.indexOf(id) * 101);
    const count = id === 'aquarium' ? 7 : id === 'clouds' ? 6 : 9;
    this.movers = Array.from({ length: count }, () => ({
      x: rnd() * SCENE_W,
      y: id === 'clouds' ? 30 + rnd() * 150 : 60 + rnd() * (SCENE_H - 140),
      speed: id === 'lanterns' ? 8 + rnd() * 8 : 12 + rnd() * 22,
      size: id === 'clouds' ? 40 + rnd() * 40 : 14 + rnd() * 16,
      phase: rnd() * Math.PI * 2,
    }));
    this.bubbles = Array.from({ length: id === 'aquarium' ? 14 : 0 }, () => ({
      x: rnd() * SCENE_W,
      y: rnd() * SCENE_H,
      speed: 10 + rnd() * 14,
      size: 2 + rnd() * 3,
      phase: rnd() * Math.PI * 2,
    }));
    this.draw();
  }

  get width(): number {
    return SCENE_W;
  }

  get height(): number {
    return SCENE_H;
  }

  update(dtMs: number): void {
    const dt = Math.min(0.1, dtMs / 1000);
    this.t += dt;
    for (const m of this.movers) {
      if (this.id === 'lanterns') {
        m.y -= m.speed * dt;
        if (m.y < -40) m.y = SCENE_H + 30;
      } else {
        m.x += m.speed * dt * (this.id === 'aquarium' && m.phase > Math.PI ? -1 : 1);
        if (m.x > SCENE_W + 80) m.x = -80;
        if (m.x < -80) m.x = SCENE_W + 80;
      }
    }
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      if (b.y < -10) b.y = SCENE_H - 40;
    }
    this.draw();
  }

  private sky(top: number, bottom: number): void {
    const c = this.ctx!;
    const g = c.createLinearGradient(0, 0, 0, SCENE_H);
    g.addColorStop(0, gray(top));
    g.addColorStop(1, gray(bottom));
    c.fillStyle = g;
    c.fillRect(0, 0, SCENE_W, SCENE_H);
  }

  private draw(): void {
    const c = this.ctx;
    if (!c) return;
    if (this.id === 'aquarium') this.drawAquarium(c);
    else if (this.id === 'clouds') this.drawClouds(c);
    else this.drawLanterns(c);
  }

  private drawAquarium(c: CanvasRenderingContext2D): void {
    this.sky(0.16, 0.3);
    // Sand and swaying plants.
    c.fillStyle = gray(0.42);
    c.beginPath();
    c.moveTo(0, SCENE_H);
    for (let x = 0; x <= SCENE_W; x += 40) c.lineTo(x, SCENE_H - 34 - 6 * Math.sin(x * 0.02));
    c.lineTo(SCENE_W, SCENE_H);
    c.fill();
    c.strokeStyle = gray(0.5);
    c.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
      const x0 = 30 + i * 70;
      c.beginPath();
      c.moveTo(x0, SCENE_H - 30);
      for (let k = 1; k <= 6; k++) {
        const sway = 6 * Math.sin(this.t * 0.6 + i + k * 0.5) * (k / 6);
        c.lineTo(x0 + sway, SCENE_H - 30 - k * 16);
      }
      c.stroke();
    }
    // Fish: body, tail, eye; a gentle bob.
    for (const f of this.movers) {
      const dir = f.phase > Math.PI ? -1 : 1;
      const y = f.y + 6 * Math.sin(this.t * 0.8 + f.phase);
      c.fillStyle = gray(0.78);
      c.beginPath();
      c.ellipse(f.x, y, f.size * 1.6, f.size * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(f.x - dir * f.size * 1.4, y);
      c.lineTo(f.x - dir * f.size * 2.4, y - f.size * 0.7);
      c.lineTo(f.x - dir * f.size * 2.4, y + f.size * 0.7);
      c.closePath();
      c.fill();
      c.fillStyle = gray(0.2);
      c.beginPath();
      c.arc(f.x + dir * f.size * 0.9, y - f.size * 0.15, Math.max(1.5, f.size * 0.12), 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = gray(0.7, 0.8);
    c.lineWidth = 1.5;
    for (const b of this.bubbles) {
      c.beginPath();
      c.arc(b.x + 3 * Math.sin(this.t + b.phase), b.y, b.size, 0, Math.PI * 2);
      c.stroke();
    }
  }

  private drawClouds(c: CanvasRenderingContext2D): void {
    this.sky(0.55, 0.78);
    for (const m of this.movers) {
      c.fillStyle = gray(0.93, 0.92);
      for (let k = 0; k < 5; k++) {
        const dx = (k - 2) * m.size * 0.55;
        const dy = Math.abs(k - 2) * m.size * 0.12;
        c.beginPath();
        c.arc(m.x + dx, m.y + dy, m.size * (k === 2 ? 0.62 : 0.45), 0, Math.PI * 2);
        c.fill();
      }
    }
    // Two layers of hills.
    for (const [base, amp, v] of [
      [SCENE_H - 70, 22, 0.42],
      [SCENE_H - 35, 16, 0.3],
    ] as const) {
      c.fillStyle = gray(v);
      c.beginPath();
      c.moveTo(0, SCENE_H);
      for (let x = 0; x <= SCENE_W; x += 20) c.lineTo(x, base - amp * Math.sin(x * 0.012 + v * 10));
      c.lineTo(SCENE_W, SCENE_H);
      c.fill();
    }
  }

  private drawLanterns(c: CanvasRenderingContext2D): void {
    this.sky(0.08, 0.22);
    // Calm water with a faint horizon line.
    c.fillStyle = gray(0.14);
    c.fillRect(0, SCENE_H - 60, SCENE_W, 60);
    c.strokeStyle = gray(0.3);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, SCENE_H - 60);
    c.lineTo(SCENE_W, SCENE_H - 60);
    c.stroke();
    for (const m of this.movers) {
      const x = m.x + 10 * Math.sin(this.t * 0.4 + m.phase);
      const w = m.size;
      const h = m.size * 1.3;
      const glow = c.createRadialGradient(x, m.y, 2, x, m.y, w * 1.6);
      glow.addColorStop(0, gray(0.55, 0.5));
      glow.addColorStop(1, gray(0.55, 0));
      c.fillStyle = glow;
      c.fillRect(x - w * 1.6, m.y - w * 1.6, w * 3.2, w * 3.2);
      c.fillStyle = gray(0.72);
      c.beginPath();
      c.roundRect?.(x - w / 2, m.y - h / 2, w, h, 5);
      if (!c.roundRect) c.rect(x - w / 2, m.y - h / 2, w, h);
      c.fill();
    }
  }
}
