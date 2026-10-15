import { describe, expect, it } from 'vitest';
import {
  contrastStimulus,
  filterLayers,
  ghostStimulus,
  glassesStimulus,
  monoLeftStimulus,
  monoRightStimulus,
  offsetStimulus,
  worthFourDotResult,
  worthStimulus,
} from '../../src/calibration/stimuli';
import { DEFAULT_CHANNEL_MAP, type EyeChannelMap } from '../../src/engine/renderer';

const SWAPPED: EyeChannelMap = { left: DEFAULT_CHANNEL_MAP.right, right: DEFAULT_CHANNEL_MAP.left };

/** A 2D context that records which shapes were drawn. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, prop: string) =>
        (...args: unknown[]) => {
          if (['fillRect', 'strokeRect', 'arc', 'fillText', 'lineTo', 'stroke', 'fill'].includes(prop))
            calls.push(`${prop}${prop === 'fillText' ? `:${String(args[0])}` : ''}`);
        },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function drawBoth(
  draw: (l: CanvasRenderingContext2D, r: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const l = recorder();
  const r = recorder();
  draw(l.ctx, r.ctx, 800, 400);
  return { left: l.calls, right: r.calls };
}

describe('calibration stimuli', () => {
  it('maps the red and cyan filters to the right eye layers for either glasses orientation', () => {
    const l = recorder().ctx;
    const r = recorder().ctx;
    const normal = filterLayers(DEFAULT_CHANNEL_MAP, l, r);
    expect(normal.red).toBe(l);
    expect(normal.cyan).toBe(r);
    const swapped = filterLayers(SWAPPED, l, r);
    expect(swapped.red).toBe(r);
    expect(swapped.cyan).toBe(l);
  });

  it('glasses check: square A behind red, square B behind cyan', () => {
    const normal = drawBoth(glassesStimulus(DEFAULT_CHANNEL_MAP));
    expect(normal.left).toContain('fillText:A');
    expect(normal.right).toContain('fillText:B');
    const swapped = drawBoth(glassesStimulus(SWAPPED));
    expect(swapped.right).toContain('fillText:A');
    expect(swapped.left).toContain('fillText:B');
  });

  it('monocular and ghost checks draw in one eye only', () => {
    expect(drawBoth(monoLeftStimulus).right).toEqual([]);
    expect(drawBoth(monoRightStimulus).left).toEqual([]);
    expect(drawBoth(ghostStimulus).right).toEqual([]);
  });

  it('Worth 4-dot: red eye 2 dots (top + bottom), cyan eye 3 dots (left, right, bottom)', () => {
    const d = drawBoth(worthStimulus(DEFAULT_CHANNEL_MAP));
    expect(d.left.filter((c) => c === 'arc')).toHaveLength(2);
    expect(d.right.filter((c) => c === 'arc')).toHaveLength(3);
  });

  it('offset and contrast stimuli give each eye its own target plus a shared frame', () => {
    for (const draw of [offsetStimulus, contrastStimulus]) {
      const d = drawBoth(draw);
      expect(d.left).toContain('strokeRect');
      expect(d.right).toContain('strokeRect');
      expect(d.left.length).toBeGreaterThan(1);
      expect(d.right.length).toBeGreaterThan(1);
    }
  });

  it('interprets the Worth 4-dot answer for either glasses orientation', () => {
    expect(worthFourDotResult(4, false, DEFAULT_CHANNEL_MAP)).toBe('fusion');
    expect(worthFourDotResult(5, false, DEFAULT_CHANNEL_MAP)).toBe('diplopia');
    expect(worthFourDotResult(null, true, DEFAULT_CHANNEL_MAP)).toBe('alternating');
    expect(worthFourDotResult(null, false, DEFAULT_CHANNEL_MAP)).toBe('unknown');
    // Default glasses: red on the left eye. 3 dots = only the cyan (right) eye sees.
    expect(worthFourDotResult(3, false, DEFAULT_CHANNEL_MAP)).toBe('left-suppression');
    expect(worthFourDotResult(2, false, DEFAULT_CHANNEL_MAP)).toBe('right-suppression');
    expect(worthFourDotResult(3, false, SWAPPED)).toBe('right-suppression');
    expect(worthFourDotResult(2, false, SWAPPED)).toBe('left-suppression');
  });
});
