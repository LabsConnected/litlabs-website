"use client";

import { useEffect, useState } from "react";

export type LiTTState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "success"
  | "error";

export type LiTTPresenceVariant = "empty-state" | "chat-avatar" | "terminal";
export type LiTTPresenceSize = "sm" | "md" | "lg";

interface LiTTPresenceProps {
  state: LiTTState;
  variant: LiTTPresenceVariant;
  size?: LiTTPresenceSize;
}

const SIZE_MAP: Record<LiTTPresenceVariant, Record<LiTTPresenceSize, { w: number; h: number }>> = {
  "empty-state": {
    sm: { w: 104, h: 104 },
    md: { w: 144, h: 144 },
    lg: { w: 184, h: 184 },
  },
  "chat-avatar": {
    sm: { w: 28, h: 28 },
    md: { w: 32, h: 32 },
    lg: { w: 36, h: 36 },
  },
  "terminal": {
    sm: { w: 36, h: 36 },
    md: { w: 42, h: 42 },
    lg: { w: 48, h: 48 },
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
          backgroundColor: "rgba(114,242,56,0.06)",
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
          className="h-full w-full object-cover"
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
      className={`relative grid place-items-center ${animationClass}`}
      style={{
        width: dims.w,
        height: dims.h,
      }}
      aria-label={`LiTT ${state}`}
    >
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt="LiTT mascot"
        width={dims.w}
        height={dims.h}
        className="object-contain"
        style={{ filter: `drop-shadow(0 0 20px ${colors.glow})` }}
      />
    </div>
  );
}
