import { inverseMatrix, transformToMatrix } from '../affine';
import type { EyeLayers, RenderOptions } from './types';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_left;
uniform sampler2D u_right;
uniform vec2 u_size;
uniform mat3 u_invLeft;
uniform mat3 u_invRight;
uniform vec3 u_colorLeft;
uniform vec3 u_colorRight;
uniform float u_gammaLeft;
uniform float u_gammaRight;
uniform float u_bg;

float sampleEye(sampler2D tex, mat3 inv, float gamma) {
  vec3 p = inv * vec3(v_uv * u_size, 1.0);
  vec2 uv = p.xy / u_size;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec4 c = texture2D(tex, uv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) * c.a;
  return pow(clamp(lum, 0.0, 1.0), gamma);
}

void main() {
  float l = sampleEye(u_left, u_invLeft, u_gammaLeft);
  float r = sampleEye(u_right, u_invRight, u_gammaRight);
  vec3 color = vec3(u_bg) + u_colorLeft * l + u_colorRight * r;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/**
 * WebGL anaglyph compositor with per-eye gamma and gain (ghosting compensation) and
 * per-eye affine sampling. Also the backend used by the dichoptic video module.
 */
export class WebglAnaglyphBackend {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texLeft: WebGLTexture | null = null;
  private texRight: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private width = 0;
  private height = 0;
  private canvas: HTMLCanvasElement | null = null;

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  }

  attach(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.canvas = canvas;
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL program creation failed');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    this.program = program;
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of [
      'u_left',
      'u_right',
      'u_size',
      'u_invLeft',
      'u_invRight',
      'u_colorLeft',
      'u_colorRight',
      'u_gammaLeft',
      'u_gammaRight',
      'u_bg',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.texLeft = makeTexture(gl);
    this.texRight = makeTexture(gl);
    this.resize(width, height, dpr);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this.gl?.viewport(0, 0, this.canvas?.width ?? 1, this.canvas?.height ?? 1);
  }

  composite(layers: EyeLayers, options: RenderOptions): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    gl.useProgram(this.program);
    upload(gl, this.texLeft, layers.left, 0);
    upload(gl, this.texRight, layers.right, 1);
    gl.uniform1i(this.uniforms['u_left'] ?? null, 0);
    gl.uniform1i(this.uniforms['u_right'] ?? null, 1);
    gl.uniform2f(this.uniforms['u_size'] ?? null, this.width, this.height);
    const cx = this.width / 2;
    const cy = this.height / 2;
    gl.uniformMatrix3fv(
      this.uniforms['u_invLeft'] ?? null,
      false,
      toMat3(inverseMatrix(transformToMatrix(options.transforms.left, cx, cy))),
    );
    gl.uniformMatrix3fv(
      this.uniforms['u_invRight'] ?? null,
      false,
      toMat3(inverseMatrix(transformToMatrix(options.transforms.right, cx, cy))),
    );
    const cl = options.channels.left;
    const cr = options.channels.right;
    const il = cl.gain * options.contrast.left;
    const ir = cr.gain * options.contrast.right;
    gl.uniform3fv(this.uniforms['u_colorLeft'] ?? null, unitColor(cl.channel, il));
    gl.uniform3fv(this.uniforms['u_colorRight'] ?? null, unitColor(cr.channel, ir));
    gl.uniform1f(this.uniforms['u_gammaLeft'] ?? null, cl.gamma || 1);
    gl.uniform1f(this.uniforms['u_gammaRight'] ?? null, cr.gamma || 1);
    gl.uniform1f(this.uniforms['u_bg'] ?? null, options.backgroundGray / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.texLeft) gl.deleteTexture(this.texLeft);
      if (this.texRight) gl.deleteTexture(this.texRight);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
    this.canvas = null;
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader creation failed');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`WebGL shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
  }
  return shader;
}

function makeTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('WebGL texture creation failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function upload(
  gl: WebGLRenderingContext,
  tex: WebGLTexture | null,
  source: TexImageSource,
  unit: number,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function toMat3(m: [number, number, number, number, number, number]): Float32Array {
  // column-major 3x3 for GLSL: columns (a,b,0), (c,d,0), (e,f,1)
  return new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
}

function unitColor(channel: 'red' | 'cyan', intensity: number): Float32Array {
  const v = Math.max(0, Math.min(1, intensity));
  return channel === 'red' ? new Float32Array([v, 0, 0]) : new Float32Array([0, v, v]);
}
