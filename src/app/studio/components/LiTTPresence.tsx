"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

export type LiTTState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "success"
  | "error";

export type LiTTPresenceVariant = "empty-state" | "chat-avatar" | "terminal";
export type LiTTPresenceSize = "sm" | "md" | "lg" | "xl";

interface LiTTPresenceProps {
  state: LiTTState;
  variant: LiTTPresenceVariant;
  size?: LiTTPresenceSize;
}

const SIZE_MAP: Record<LiTTPresenceVariant, Record<LiTTPresenceSize, { w: number; h: number }>> = {
  "empty-state": {
    sm: { w: 104, h: 104 },
    md: { w: 132, h: 132 },
    lg: { w: 152, h: 152 },
    xl: { w: 176, h: 176 },
  },
  "chat-avatar": {
    sm: { w: 28, h: 28 },
    md: { w: 32, h: 32 },
    lg: { w: 36, h: 36 },
    xl: { w: 36, h: 36 },
  },
  "terminal": {
    sm: { w: 36, h: 36 },
    md: { w: 42, h: 42 },
    lg: { w: 48, h: 48 },
    xl: { w: 48, h: 48 },
  },
};

const STATE_COLORS: Record<LiTTState, { ring: string; glow: string }> = {
  idle: { ring: "rgba(114,242,56,0.3)", glow: "rgba(114,242,56,0.15)" },
  listening: { ring: "rgba(34,211,238,0.5)", glow: "rgba(34,211,238,0.2)" },
  thinking: { ring: "rgba(167,139,250,0.5)", glow: "rgba(167,139,250,0.2)" },
  working: { ring: "rgba(114,242,56,0.6)", glow: "rgba(114,242,56,0.25)" },
  success: { ring: "rgba(114,242,56,0.8)", glow: "rgba(114,242,56,0.3)" },
  error: { ring: "rgba(239,68,68,0.5)", glow: "rgba(245,158,11,0.2)" },
};

/**
 * LiTTPresence — the LiTT cutout mascot component.
 *
 * Uses transparent WebP images with a green energy platform.
 * Animations are CSS-based and respect prefers-reduced-motion.
 */
export default function LiTTPresence({
  state,
  variant,
  size = "md",
}: LiTTPresenceProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0, rot: 0 });
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const dims = SIZE_MAP[variant][size];
  const colors = STATE_COLORS[state];
  const isAvatar = variant === "chat-avatar";
  const isTerminal = variant === "terminal";
  const isEmptyState = variant === "empty-state";

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEmptyState || reducedMotion) return;
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const py = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const x = (px - 0.5) * 14;
    const y = (py - 0.5) * 12;
    setTilt({ x, y, rot: x * 0.55 });
  };

  const resetTilt = () => {
    if (!isEmptyState || reducedMotion) return;
    setTilt({ x: 0, y: 0, rot: 0 });
  };

  // Image sources — use optimized sizes
  const imgSrc = isAvatar
    ? "/brand/litt/litt-avatar-64.webp"
    : size === "sm"
    ? "/brand/litt/litt-cutout-platform-128.webp"
    : "/brand/litt/litt-cutout-platform-256.webp";

  const animationClass = reducedMotion
    ? ""
    : state === "idle"
    ? "litt-hover-idle"
    : state === "thinking" || state === "working"
    ? "litt-hover-working"
    : state === "listening"
    ? "litt-hover-listening"
    : state === "error"
    ? "litt-flicker-error"
    : "";

  if (isAvatar) {
    // Chat avatar — small circle beside assistant messages
    return (
      <div
        className={`relative shrink-0 rounded-full ${animationClass}`}
        style={{
          width: dims.w,
          height: dims.h,
          border: `1.5px solid ${colors.ring}`,
          boxShadow: `0 0 12px ${colors.glow}`,
          backgroundColor: "transparent",
          overflow: "hidden",
        }}
        aria-label={`LiTT ${state}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt="LiTT"
          width={dims.w}
          height={dims.h}
          className="h-full w-full object-contain p-0.5"
        />
      </div>
    );
  }

  if (isTerminal) {
    // Terminal compact avatar — head + shoulders with status ring
    return (
      <div
        className={`relative grid place-items-center rounded-lg ${animationClass}`}
        style={{
          width: dims.w,
          height: dims.h,
          border: `1px solid ${colors.ring}`,
          boxShadow: `0 0 16px ${colors.glow}`,
          backgroundColor: "rgba(114,242,56,0.06)",
          overflow: "hidden",
        }}
        aria-label={`LiTT ${state}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/litt/litt-avatar-64.webp"
          alt="LiTT"
          width={dims.w - 8}
          height={dims.h - 8}
          className="object-contain"
        />
      </div>
    );
  }

  // Empty state — full cutout with green platform
  return (
    <div
      ref={shellRef}
      className={`litt-presence-shell relative grid place-items-center overflow-hidden rounded-[28px] ${animationClass}`}
      data-state={state}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerMove}
      onPointerLeave={resetTilt}
      style={{
        width: dims.w,
        height: dims.h,
        ["--litt-x" as never]: `${tilt.x}px`,
        ["--litt-y" as never]: `${tilt.y}px`,
        ["--litt-rot" as never]: `${tilt.rot}deg`,
      } as CSSProperties}
      aria-label={`LiTT ${state}`}
    >
      {/* Ambient motion layers */}
      <div
        className="litt-ambient-grid absolute inset-0 rounded-[inherit] opacity-50"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 50% 80%, rgba(114,242,56,0.22), transparent 52%)",
            "linear-gradient(rgba(114,242,56,0.08) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(114,242,56,0.08) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "100% 100%, 28px 28px, 28px 28px",
          backgroundPosition: "0 0, 0 0, 0 0",
          maskImage: "radial-gradient(circle at 50% 48%, black 58%, transparent 92%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 48%, black 58%, transparent 92%)",
        }}
        aria-hidden
      />
      <div
        className="litt-pulse-ring absolute inset-[10%] rounded-full border"
        style={{
          borderColor: colors.ring,
          boxShadow: `0 0 30px ${colors.glow}`,
        }}
        aria-hidden
      />
      {/* Green platform glow underneath */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
        style={{
          width: "70%",
          height: 8,
          background: `radial-gradient(ellipse, ${colors.glow}, transparent 70%)`,
          filter: "blur(4px)",
        }}
        aria-hidden
      />
      <div
        className="litt-presence-figure relative grid place-items-center"
        style={{ width: dims.w, height: dims.h }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt="LiTT mascot"
          width={dims.w}
          height={dims.h}
          className="object-contain"
          style={{ filter: `drop-shadow(0 0 20px ${colors.glow})` }}
        />
        <span
          className="litt-eye-blink pointer-events-none absolute left-1/2 top-[36%] h-[7%] w-[30%] -translate-x-1/2 rounded-full bg-[#0b0f14]/70 blur-[0.5px]"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute bottom-[12%] left-1/2 h-[8%] w-[46%] -translate-x-1/2 rounded-full"
          style={{
            background: `radial-gradient(circle, ${colors.glow}, transparent 72%)`,
            opacity: state === "listening" ? 0.9 : 0.65,
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
