import type { EyeTransform } from '../affine';
import type { Eye } from '../units';

export type { Eye };

/** Anaglyph filter channel. All mapping is runtime data from calibration. */
export type ChannelName = 'red' | 'cyan';

export interface ChannelSettings {
  channel: ChannelName;
  /** 0..1 multiplier on the channel's intensity (ghosting reduction). */
  gain: number;
  /** Gamma applied to the eye's layer luminance (WebGL backend only). */
  gamma: number;
}

export interface EyeChannelMap {
  left: ChannelSettings;
  right: ChannelSettings;
}

export const DEFAULT_CHANNEL_MAP: EyeChannelMap = {
  left: { channel: 'red', gain: 1, gamma: 1 },
  right: { channel: 'cyan', gain: 1, gamma: 1 },
};

export interface RenderOptions {
  transforms: { left: EyeTransform; right: EyeTransform };
  channels: EyeChannelMap;
  /** Per-eye stimulus contrast 0..1 (dichoptic balance). */
  contrast: { left: number; right: number };
  /** Neutral dark background (0..255 gray). Red filters leak green; keep it dark. */
  backgroundGray: number;
}

export interface EyeLayers {
  left: HTMLCanvasElement;
  right: HTMLCanvasElement;
}

export type RendererId = 'anaglyph-canvas2d' | 'anaglyph-webgl' | 'sbs' | 'webxr';

export interface StereoRenderer {
  readonly id: RendererId;
  readonly supported: boolean;
  /** Bind the output canvas. width/height are CSS px; dpr sizes the backing store. */
  attach(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void;
  resize(width: number, height: number, dpr: number): void;
  /** Composite the two eye layers into the output canvas. */
  composite(layers: EyeLayers, options: RenderOptions): void;
  dispose(): void;
}

export function channelColor(channel: ChannelName, intensity: number): [number, number, number] {
  const v = Math.round(255 * Math.max(0, Math.min(1, intensity)));
  return channel === 'red' ? [v, 0, 0] : [0, v, v];
}
