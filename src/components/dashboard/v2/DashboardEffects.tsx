"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/* ─── Ambient Background ─────────────────────────────────────────────── */

export function DashboardAmbientBackground() {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Base */}
      <div className="absolute inset-0 bg-[#05050a]" />
      {/* Violet radial */}
      <motion.div
        className="absolute -right-[10%] -top-[15%] h-[55vh] w-[55vh] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)" }}
        animate={reduce ? undefined : { x: [0, 30, 0], y: [0, 20, 0] }}
        transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Cyan radial */}
      <motion.div
        className="absolute -bottom-[10%] left-[5%] h-[45vh] w-[45vh] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.10) 0%, transparent 70%)" }}
        animate={reduce ? undefined : { x: [0, -20, 0], y: [0, 15, 0] }}
        transition={{ duration: 50, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* LiTT green accent */}
      <div
        className="absolute right-[30%] top-[40%] h-[20vh] w-[20vh] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(114,242,56,0.05) 0%, transparent 70%)" }}
      />
      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Grain noise */}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

/* ─── Cursor Spotlight ───────────────────────────────────────────────── */

export function CursorSpotlight({
  children,
  className = "",
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!enabled || reduce) return;
    const el = ref.current;
    if (!el) return;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (isTouch) return;

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setVisible(true);
    };
    const handleLeave = () => setVisible(false);

    el.addEventListener("mousemove", handleMove);
    el.addEventListener("mouseleave", handleLeave);
    return () => {
      el.removeEventListener("mousemove", handleMove);
      el.removeEventListener("mouseleave", handleLeave);
    };
  }, [enabled, reduce]);

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      style={
        visible && enabled && !reduce
          ? {
              background: `radial-gradient(400px circle at ${pos.x}px ${pos.y}px, rgba(139,92,246,0.06), transparent 70%)`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/* ─── Border Beam ────────────────────────────────────────────────────── */

export function BorderBeam({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={`relative ${className}`}>
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          padding: 1,
          background: "linear-gradient(120deg, rgba(139,92,246,0.4), rgba(34,211,238,0.3), rgba(139,92,246,0.4))",
          backgroundSize: "200% 100%",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          animation: reduce ? undefined : "borderBeam 4s linear infinite",
        }}
      />
      {children}
    </div>
  );
}

/* ─── Status Pulse ───────────────────────────────────────────────────── */

export function StatusPulse({
  color,
  label,
  detail,
  pulse = false,
}: {
  color: string;
  label: string;
  detail?: string;
  pulse?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-2.5 w-2.5">
        {pulse && !reduce && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }}
        />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold leading-tight" style={{ color: "var(--dash-text-primary)" }}>
          {label}
        </div>
        {detail && (
          <div className="text-[10px] leading-tight" style={{ color: "var(--dash-text-dim)" }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Entrance Animation Wrapper ─────────────────────────────────────── */

export function EntranceSection({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Glass Panel ────────────────────────────────────────────────────── */

export function GlassPanel({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border ${hover ? "transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.005]" : ""} ${className}`}
      style={{
        background: "rgba(10,9,18,0.70)",
        backdropFilter: "blur(18px)",
        borderColor: "rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {children}
    </div>
  );
}
