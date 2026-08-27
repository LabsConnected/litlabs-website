"use client";

/**
 * AnimatedBackground — subtle dark/violet WebGL shader background.
 *
 * Based on the mock's shader but rebuilt for production:
 *   - Pauses on tab hidden (visibilitychange)
 *   - Honors prefers-reduced-motion (static gradient fallback)
 *   - Clean WebGL fallback (CSS gradient if WebGL unavailable)
 *   - Low GPU: single pass, no post-processing
 *   - Never harms readability (opacity 0.4, subtle colors)
 */

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
varying vec2 v_texCoord;
float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 uv = v_texCoord;
    vec3 color = vec3(0.02, 0.01, 0.04);
    float flow = sin(uv.x * 2.0 + u_time * 0.5) * 0.5 + 0.5;
    float glow = smoothstep(0.4, 0.6, flow) * 0.05;
    vec3 accent = vec3(0.65, 0.55, 0.98);
    color += accent * glow * uv.y;
    color += (noise(uv + u_time * 0.01) - 0.5) * 0.01;
    gl_FragColor = vec4(color, 1.0);
}
`;

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);

  useEffect(() => {
    // Check prefers-reduced-motion
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) return; // CSS fallback handles it

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) return; // CSS fallback handles it

    glRef.current = gl;

    const glCtx = gl; // non-null after check above
    const canvasEl = canvas; // non-null after check above

    // Compile shaders
    function compileShader(type: number, src: string): WebGLShader | null {
      const shader = glCtx.createShader(type);
      if (!shader) return null;
      glCtx.shaderSource(shader, src);
      glCtx.compileShader(shader);
      if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        glCtx.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compileShader(glCtx.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(glCtx.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = glCtx.createProgram();
    if (!program) return;
    glCtx.attachShader(program, vs);
    glCtx.attachShader(program, fs);
    glCtx.linkProgram(program);
    if (!glCtx.getProgramParameter(program, glCtx.LINK_STATUS)) return;
    glCtx.useProgram(program);

    // Full-screen quad
    const buffer = glCtx.createBuffer();
    glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buffer);
    glCtx.bufferData(
      glCtx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      glCtx.STATIC_DRAW,
    );

    const posLoc = glCtx.getAttribLocation(program, "a_position");
    glCtx.enableVertexAttribArray(posLoc);
    glCtx.vertexAttribPointer(posLoc, 2, glCtx.FLOAT, false, 0, 0);

    const timeLoc = glCtx.getUniformLocation(program, "u_time");

    // Resize handling
    function syncSize() {
      const w = canvasEl.clientWidth || 1280;
      const h = canvasEl.clientHeight || 720;
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w;
        canvasEl.height = h;
      }
    }

    syncSize();
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(canvasEl);

    // Render loop
    let running = true;

    function render(t: number) {
      if (!running) return;
      syncSize();
      glCtx.viewport(0, 0, canvasEl.width, canvasEl.height);
      if (timeLoc) glCtx.uniform1f(timeLoc, t * 0.001);
      glCtx.drawArrays(glCtx.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);

    // Pause on tab hidden
    function onVisibilityChange() {
      if (document.hidden) {
        running = false;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else if (!running) {
        running = true;
        rafRef.current = requestAnimationFrame(render);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      running = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      glCtx.deleteProgram(program);
      glCtx.deleteShader(vs);
      glCtx.deleteShader(fs);
      if (buffer) glCtx.deleteBuffer(buffer);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity: 0.4 }}
      aria-hidden="true"
    >
      {/* WebGL canvas (hidden if reduced-motion or no WebGL) */}
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      {/* CSS fallback gradient (always present, behind canvas) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 70% 20%, rgba(139,92,246,0.12) 0%, transparent 50%), radial-gradient(ellipse at 20% 80%, rgba(34,211,238,0.06) 0%, transparent 50%), #05050a",
        }}
      />
    </div>
  );
}
