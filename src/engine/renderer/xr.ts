import type { EyeTransform } from '../affine';
import type { ScreenGeometry } from '../units';
import type { EyeLayers, RenderOptions, RendererId, StereoRenderer } from './types';

/**
 * WebXR (VR headset) presentation, beta.
 *
 * A headset has one display per eye, so there is no colour filter and no crosstalk: each
 * eye simply sees its own layer, in grey, on a flat panel fixed in the room ("world-
 * locked") straight ahead. Comfort and safety choices:
 *  - The panel never follows the head and nothing moves the viewer (no artificial motion).
 *  - The panel has the same angular size as the calibrated screen, so a module's sizes and
 *    the calibrated prism offset (in Δ) mean the same thing in the headset.
 *  - Squeezing a controller's grip is STOP; the trigger is the action key (Space).
 *  - Leaving VR (system button, headset off) pauses the session.
 * The app keeps its own limits for VR (shorter sessions, a comfort notice); see TrainingShell.
 */

// ---- Minimal WebXR typings (the DOM lib does not include WebXR) ----

interface XRRigidTransformLike {
  readonly matrix: Float32Array;
  readonly inverse: XRRigidTransformLike;
}
interface XRViewLike {
  readonly eye: 'left' | 'right' | 'none';
  readonly projectionMatrix: Float32Array;
  readonly transform: XRRigidTransformLike;
}
interface XRViewerPoseLike {
  readonly views: readonly XRViewLike[];
}
interface XRFrameLike {
  getViewerPose(space: unknown): XRViewerPoseLike | null;
}
interface XRInputSourceLike {
  readonly gamepad?: { readonly axes: readonly number[] } | null;
}
interface XRWebGLLayerLike {
  readonly framebuffer: WebGLFramebuffer | null;
  getViewport(view: XRViewLike): { x: number; y: number; width: number; height: number } | null;
}
interface XRSessionLike extends EventTarget {
  readonly inputSources: Iterable<XRInputSourceLike>;
  requestReferenceSpace(type: 'local'): Promise<unknown>;
  requestAnimationFrame(cb: (time: number, frame: XRFrameLike) => void): number;
  updateRenderState(state: { baseLayer: XRWebGLLayerLike }): void | Promise<void>;
  end(): Promise<void>;
}
interface XRSystemLike {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  requestSession(mode: 'immersive-vr', init?: { requiredFeatures?: string[] }): Promise<XRSessionLike>;
}
type XRWebGLLayerCtor = new (session: XRSessionLike, gl: WebGLRenderingContext) => XRWebGLLayerLike;

function xrSystem(): XRSystemLike | null {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as Navigator & { xr?: XRSystemLike }).xr ?? null) as XRSystemLike | null;
}

export async function immersiveVrSupported(): Promise<boolean> {
  const xr = xrSystem();
  if (!xr || typeof window === 'undefined' || !('XRWebGLLayer' in window)) return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/** VR sessions are kept shorter than screen sessions (cybersickness). */
export const VR_MAX_SESSION_MINUTES = 10;
/** The panel sits this far in front of the starting head position. */
export const VR_PANEL_DISTANCE_M = 1.5;

// ---- Pure geometry (unit-tested) ----

export interface VrLayout {
  /** Metres on the panel per CSS px of the eye layer. */
  metersPerPx: number;
  widthM: number;
  heightM: number;
  distanceM: number;
}

/**
 * Scale the layer so it covers the same visual angle as on the calibrated screen:
 * 1 CSS px on screen is (2.54 / ppi) cm at the viewing distance; at the panel distance
 * the same angle is that size times (panel distance / viewing distance).
 */
export function vrLayout(
  geometry: ScreenGeometry,
  layerWidthPx: number,
  layerHeightPx: number,
  distanceM = VR_PANEL_DISTANCE_M,
): VrLayout {
  const metersPerPx = (0.0254 / geometry.ppi) * (distanceM / geometry.distanceM);
  return { metersPerPx, widthM: layerWidthPx * metersPerPx, heightM: layerHeightPx * metersPerPx, distanceM };
}

/**
 * Column-major model matrix for one eye's panel: scale to the panel size, rotate by the
 * eye's cyclotorsion setting, then place it straight ahead, shifted by the eye's offset
 * (screen x right = world x right; screen y down = world y down; clockwise on screen is a
 * negative rotation about the viewing axis).
 */
export function eyePanelMatrix(transform: EyeTransform, layout: VrLayout): Float32Array {
  const r = (-transform.rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const w = layout.widthM;
  const h = layout.heightM;
  const tx = transform.dx * layout.metersPerPx;
  const ty = -transform.dy * layout.metersPerPx;
  // prettier-ignore
  return new Float32Array([
    c * w, s * w, 0, 0,
    -s * h, c * h, 0, 0,
    0, 0, 1, 0,
    tx, ty, -layout.distanceM, 1,
  ]);
}

/** Thumbstick → held direction, with a dead zone. xr-standard puts the stick on axes 2/3. */
export function xrDirection(axes: readonly number[], deadZone = 0.35): { dx: number; dy: number } {
  const x = axes.length >= 4 ? (axes[2] ?? 0) : (axes[0] ?? 0);
  const y = axes.length >= 4 ? (axes[3] ?? 0) : (axes[1] ?? 0);
  const dz = (v: number) => (Math.abs(v) < deadZone ? 0 : Math.round(v * 10) / 10);
  return { dx: dz(x), dy: dz(y) };
}

// ---- Renderer ----

const VS = `
attribute vec2 a_pos;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x + 0.5, 0.5 - a_pos.y);
  gl_Position = u_proj * u_view * u_model * vec4(a_pos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_contrast;
uniform float u_bg;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float v = u_bg + (1.0 - u_bg) * l * u_contrast;
  gl_FragColor = vec4(vec3(v), 1.0);
}`;

export interface XrCallbacks {
  /** Called once per headset frame, before drawing: update and draw the module here. */
  frame?: (dtMs: number, nowMs: number) => void;
  action?: () => void;
  stop?: () => void;
  direction?: (dx: number, dy: number) => void;
  ended?: () => void;
}

export class WebXRRenderer implements StereoRenderer {
  readonly id: RendererId = 'webxr';
  readonly supported = xrSystem() !== null;
  private canvas: HTMLCanvasElement | null = null;
  private width = 1;
  private height = 1;
  private geometry: ScreenGeometry | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private textures: { left: WebGLTexture | null; right: WebGLTexture | null } = { left: null, right: null };
  private session: XRSessionLike | null = null;
  private refSpace: unknown = null;
  private glLayer: XRWebGLLayerLike | null = null;
  private pending: { layers: EyeLayers; options: RenderOptions } | null = null;
  private callbacks: XrCallbacks = {};
  private lastTime = 0;
  private lastDir = { dx: 0, dy: 0 };

  get presenting(): boolean {
    return this.session !== null;
  }

  attach(canvas: HTMLCanvasElement, width: number, height: number, _dpr: number): void {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
  }

  resize(width: number, height: number, _dpr: number): void {
    this.width = width;
    this.height = height;
  }

  /** The calibrated screen geometry, needed to keep angular sizes and Δ offsets. */
  configure(geometry: ScreenGeometry, callbacks: XrCallbacks): void {
    this.geometry = geometry;
    this.callbacks = callbacks;
  }

  /** Remember the latest layers; they are drawn in the next headset frame. */
  composite(layers: EyeLayers, options: RenderOptions): void {
    this.pending = { layers, options };
  }

  /** Must be called from a user gesture (a click on "Enter VR"). */
  async startSession(): Promise<void> {
    const xr = xrSystem();
    const Layer = (window as Window & { XRWebGLLayer?: XRWebGLLayerCtor }).XRWebGLLayer;
    if (!xr || !Layer || !this.canvas) throw new Error('WebXR is not available');
    const session = await xr.requestSession('immersive-vr', { requiredFeatures: ['local'] });
    try {
      const gl = this.initGl();
      const glLayer = new Layer(session, gl);
      await session.updateRenderState({ baseLayer: glLayer });
      this.refSpace = await session.requestReferenceSpace('local');
      this.glLayer = glLayer;
      this.session = session;
    } catch (e) {
      await session.end().catch(() => {});
      throw e;
    }
    session.addEventListener('select', () => this.callbacks.action?.());
    session.addEventListener('squeeze', () => this.callbacks.stop?.());
    session.addEventListener('end', () => {
      this.session = null;
      this.glLayer = null;
      this.callbacks.ended?.();
    });
    this.lastTime = 0;
    session.requestAnimationFrame(this.onXrFrame);
  }

  async endSession(): Promise<void> {
    await this.session?.end().catch(() => {});
  }

  private initGl(): WebGLRenderingContext {
    if (this.gl) return this.gl;
    const gl = this.canvas!.getContext('webgl', {
      xrCompatible: true,
      alpha: false,
      antialias: false,
    } as WebGLContextAttributes);
    if (!gl) throw new Error('WebGL is not available');
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.program = prog;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.textures = { left: tex(), right: tex() };
    this.gl = gl;
    return gl;
  }

  private pollInput(): void {
    if (!this.session) return;
    let dir = { dx: 0, dy: 0 };
    for (const src of this.session.inputSources) {
      const axes = src.gamepad?.axes;
      if (!axes) continue;
      const d = xrDirection(axes);
      if (d.dx || d.dy) dir = d;
    }
    if (dir.dx !== this.lastDir.dx || dir.dy !== this.lastDir.dy) {
      this.lastDir = dir;
      this.callbacks.direction?.(dir.dx, dir.dy);
    }
  }

  private readonly onXrFrame = (time: number, frame: XRFrameLike) => {
    const session = this.session;
    if (!session) return;
    session.requestAnimationFrame(this.onXrFrame);
    const dt = this.lastTime ? Math.min(100, Math.max(0, time - this.lastTime)) : 0;
    this.lastTime = time;
    this.pollInput();
    this.callbacks.frame?.(dt, time);
    const pose = frame.getViewerPose(this.refSpace);
    const gl = this.gl;
    const layer = this.glLayer;
    const pending = this.pending;
    if (!pose || !gl || !layer || !pending || !this.geometry) return;
    const { options, layers } = pending;
    const bg = Math.max(0, Math.min(1, options.backgroundGray / 255));
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(bg, bg, bg, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const layout = vrLayout(this.geometry, this.width, this.height);
    const prog = this.program!;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uploaded = new Set<string>();
    for (const view of pose.views) {
      if (view.eye !== 'left' && view.eye !== 'right') continue;
      const eye = view.eye;
      const vp = layer.getViewport(view);
      if (!vp) continue;
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[eye]);
      if (!uploaded.has(eye)) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layers[eye]);
        uploaded.add(eye);
      }
      gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
      gl.uniform1f(
        gl.getUniformLocation(prog, 'u_contrast'),
        options.contrast[eye] * options.channels[eye].gain,
      );
      gl.uniform1f(gl.getUniformLocation(prog, 'u_bg'), bg);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_proj'), false, view.projectionMatrix);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_view'), false, view.transform.inverse.matrix);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(prog, 'u_model'),
        false,
        eyePanelMatrix(options.transforms[eye], layout),
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };

  dispose(): void {
    void this.endSession();
    this.pending = null;
    this.callbacks = {};
  }
}
