"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

type LiTTStatusCardProps = {
  onClose?: () => void;
  className?: string;
};

const WAVE_BARS = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  height: 28 + ((index * 19) % 68),
  opacity: 0.45 + ((index * 7) % 45) / 100,
  delay: `${(index % 8) * 70}ms`,
}));

/**
 * Shared LiTT presence card.
 *
 * Displays LiTT's availability and provides a direct entry point into Studio.
 * The component owns no application state and can safely be reused inside
 * sidebars, drawers, dashboards, and Base Station surfaces.
 */
export default function LiTTStatusCard({
  onClose,
  className = "",
}: LiTTStatusCardProps) {
  const { resolvedColors: T } = useTheme();

  return (
    <section
      aria-label="LiTT AI assistant status"
      className={[
        "relative mt-3 overflow-hidden rounded-2xl border p-2.5",
        "shadow-[0_14px_45px_rgba(0,0,0,0.25)]",
        className,
      ].join(" ")}
      style={{
        borderColor: `${T.accentColor}40`,
        background: `
          linear-gradient(
            145deg,
            ${T.boxBg}f2 0%,
            ${T.boxBg}c9 62%,
            ${T.accentColor}10 100%
          )
        `,
      }}
    >
      <div
        className="group relative min-h-32 overflow-hidden rounded-xl border bg-cover bg-center"
        style={{
          borderColor: `${T.borderColor}28`,
          backgroundImage: `
            linear-gradient(
              to top,
              rgba(4, 5, 12, 0.98) 0%,
              rgba(4, 5, 12, 0.72) 38%,
              rgba(4, 5, 12, 0.12) 100%
            ),
            url("/api/artwork/void-entity")
          `,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-70"
          style={{
            background: `
              radial-gradient(
                circle at 70% 20%,
                ${T.accentColor}35,
                transparent 42%
              )
            `,
          }}
        />

        <div className="relative flex items-start justify-between gap-2 p-2.5">
          <span
            className="rounded-full border bg-black/65 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-violet-100 backdrop-blur-md"
            style={{
              borderColor: `${T.accentColor}55`,
            }}
          >
            LiTT
          </span>

          <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-black/65 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-300 backdrop-blur-md">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)] motion-safe:animate-pulse"
            />
            Online
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="text-sm font-black leading-tight text-white">
            Your AI building partner
          </p>

          <p className="mt-1 text-[10px] font-medium leading-relaxed text-white/65">
            Project-aware · Voice · Vision · Code
          </p>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-2.5 flex h-8 items-end justify-center gap-[3px] overflow-hidden rounded-lg border bg-black/30 px-2.5 py-1.5"
        style={{
          borderColor: `${T.borderColor}22`,
        }}
      >
        {WAVE_BARS.map((bar) => (
          <span
            key={bar.id}
            className={[
              "w-[3px] min-w-[3px] rounded-full",
              "origin-bottom",
              "motion-safe:animate-[litt-wave_1.35s_ease-in-out_infinite]",
            ].join(" ")}
            style={{
              height: `${bar.height}%`,
              opacity: bar.opacity,
              animationDelay: bar.delay,
              background: `linear-gradient(to top, ${T.accentColor}, ${T.linkColor})`,
              boxShadow: `0 0 8px ${T.accentColor}35`,
            }}
          />
        ))}
      </div>

      <Link
        href="/studio?tool=chat"
        onClick={onClose}
        aria-label="Open LiTT chat in Studio"
        className={[
          "mt-2.5 flex min-h-10 w-full items-center justify-center gap-2",
          "rounded-xl border px-3 py-2",
          "text-[10px] font-black uppercase tracking-[0.13em]",
          "transition duration-200",
          "hover:-translate-y-0.5 hover:brightness-110",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "focus-visible:ring-offset-black",
          "active:translate-y-0",
        ].join(" ")}
        style={{
          borderColor: `${T.accentColor}45`,
          background: `
            linear-gradient(
              135deg,
              ${T.accentColor}20,
              ${T.linkColor}12
            )
          `,
          color: T.headerColor,
          boxShadow: `0 8px 24px ${T.accentColor}12`,
        }}
      >
        <Sparkles aria-hidden="true" size={14} strokeWidth={2.4} />
        Ask LiTT anything
      </Link>

      <style jsx>{`
        @keyframes litt-wave {
          0%,
          100% {
            transform: scaleY(0.35);
            filter: brightness(0.85);
          }

          50% {
            transform: scaleY(1);
            filter: brightness(1.25);
          }
        }
      `}</style>
    </section>
  );
}
