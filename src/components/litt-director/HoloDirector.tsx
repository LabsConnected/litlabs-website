"use client";

import { useEffect, useRef, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";

export type DirectorState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "speaking"
  | "complete"
  | "error"
  | "approval";

export function HoloDirector({
  state = "idle",
  audioLevel = 0,
  size = 160,
}: {
  state?: DirectorState;
  audioLevel?: number;
  size?: number;
}) {
  const { resolvedColors: T } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  const stateColor = useMemo(() => {
    switch (state) {
      case "listening":
        return "#22d3ee"; // cyan
      case "thinking":
        return "#a855f7"; // purple
      case "working":
        return "#f59e0b"; // amber
      case "speaking":
        return "#22d3ee";
      case "complete":
        return "#22c55e"; // green
      case "error":
        return "#ef4444"; // red
      case "approval":
        return "#f97316"; // orange
      default:
        return T.accentColor;
    }
  }, [state, T.accentColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const ringRadius = (size * 0.38 * dpr) / 2;
    const innerRadius = (size * 0.28 * dpr) / 2;

    const draw = () => {
      tRef.current += 0.02;
      const t = tRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Base glow
      const grad = ctx.createRadialGradient(
        cx,
        cy,
        innerRadius * 0.2,
        cx,
        cy,
        ringRadius * 1.4,
      );
      grad.addColorStop(0, `${stateColor}40`);
      grad.addColorStop(0.5, `${stateColor}18`);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Outer rings
      for (let i = 0; i < 3; i++) {
        const offset = t * (0.5 + i * 0.2) + i * 2;
        const pulse = state === "working" ? 1 + Math.sin(t * 6 + i) * 0.1 : 1;
        const r = ringRadius + Math.sin(offset) * 4 * dpr * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `${stateColor}${state === "idle" ? "20" : "40"}`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([12 * dpr, 18 * dpr]);
        ctx.lineDashOffset = -t * (8 + i * 3) * dpr;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Energy particles for working/thinking
      if (state === "working" || state === "thinking") {
        const count = state === "working" ? 12 : 6;
        for (let i = 0; i < count; i++) {
          const angle =
            t * (state === "working" ? 2 : 0.5) + (i * Math.PI * 2) / count;
          const r = ringRadius + Math.sin(t * 3 + i) * 10 * dpr;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r * 0.45;
          ctx.beginPath();
          ctx.arc(x, y, 2 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = stateColor;
          ctx.fill();
        }
      }

      // Core avatar orb
      const corePulse =
        state === "speaking"
          ? 1 + audioLevel * 0.25
          : 1 + Math.sin(t * 2) * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius * corePulse, 0, Math.PI * 2);
      const coreGrad = ctx.createRadialGradient(
        cx,
        cy - innerRadius * 0.3,
        innerRadius * 0.1,
        cx,
        cy,
        innerRadius * corePulse,
      );
      coreGrad.addColorStop(0, "#ffffff");
      coreGrad.addColorStop(0.4, `${stateColor}cc`);
      coreGrad.addColorStop(1, `${stateColor}66`);
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // Face silhouette
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineCap = "round";

      // Eyes
      const eyeY = -innerRadius * 0.15;
      const eyeSpacing = innerRadius * 0.22;
      const blink = state === "idle" && Math.sin(t * 0.7) > 0.95 ? 0.1 : 1;
      ctx.beginPath();
      ctx.ellipse(
        -eyeSpacing,
        eyeY,
        innerRadius * 0.08,
        innerRadius * 0.08 * blink,
        0,
        0,
        Math.PI * 2,
      );
      ctx.ellipse(
        eyeSpacing,
        eyeY,
        innerRadius * 0.08,
        innerRadius * 0.08 * blink,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // Mouth - moves when speaking
      const mouthY = innerRadius * 0.25;
      const mouthOpen = state === "speaking" ? 0.2 + audioLevel * 0.3 : 0.05;
      ctx.beginPath();
      ctx.ellipse(
        0,
        mouthY,
        innerRadius * 0.12,
        innerRadius * mouthOpen,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();

      // Voice waveform ring when speaking/listening
      if (state === "speaking" || state === "listening") {
        const bars = 24;
        const baseR = ringRadius + 8 * dpr;
        for (let i = 0; i < bars; i++) {
          const angle = (i * Math.PI * 2) / bars;
          const h =
            (audioLevel * 12 + 3) * dpr * (1 + Math.sin(t * 8 + i * 0.5) * 0.3);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.fillStyle = `${stateColor}80`;
          ctx.fillRect(baseR, -1 * dpr, h, 2 * dpr);
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [state, audioLevel, size, stateColor]);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full blur-2xl"
        style={{
          background: `radial-gradient(circle, ${stateColor}30 0%, transparent 70%)`,
          transform: "scale(1.4)",
        }}
      />
      <canvas ref={canvasRef} className="relative z-10" />
    </div>
  );
}
