"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

/**
 * Shared "LiTT is online" promo card.
 *
 * Extracted from `src/components/Sidebar.tsx` (Phase 1 cleanup) so the same
 * visual treatment can be used in the LiTT Base Station without duplicating
 * the markup. The card is a self-contained promotional surface — it does not
 * own any state. Callers may pass an `onClose` to dismiss it (e.g. inside the
 * mobile drawer).
 */
export default function LiTTStatusCard({
  onClose,
  T,
}: {
  onClose?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <section
      className="relative mt-3 overflow-hidden rounded-2xl border p-2"
      style={{
        borderColor: `${T.accentColor}38`,
        backgroundColor: `${T.boxBg}bb`,
      }}
    >
      <div
        className="relative h-24 overflow-hidden rounded-xl border bg-cover bg-center"
        style={{
          borderColor: `${T.borderColor}20`,
          backgroundImage:
            "linear-gradient(to top, rgba(5,6,12,.95), rgba(5,6,12,.08)), url('/api/artwork/void-entity')",
        }}
      >
        <span
          className="absolute left-2 top-2 rounded-full border bg-black/65 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-violet-200"
          style={{ borderColor: `${T.accentColor}45` }}
        >
          LiTT
        </span>
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-emerald-400/25 bg-black/65 px-1.5 py-0.5 text-[7px] font-black uppercase text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{" "}
          Online
        </span>
        <div className="absolute inset-x-2 bottom-2">
          <b className="block text-[10px] text-white">Your AI building partner</b>
          <span className="text-[7px] text-white/55">
            Project-aware · voice · vision · code
          </span>
        </div>
      </div>
      <div
        className="mt-2 flex h-5 items-end gap-[2px] overflow-hidden rounded-lg border bg-black/25 px-2 py-1"
        style={{ borderColor: `${T.borderColor}18` }}
      >
        {Array.from({ length: 30 }).map((_, index) => (
          <span
            key={index}
            className="w-[2px] rounded-full"
            style={{
              height: `${22 + ((index * 19) % 72)}%`,
              opacity: 0.45 + ((index * 7) % 45) / 100,
              background: `linear-gradient(${T.accentColor}, ${T.linkColor})`,
            }}
          />
        ))}
      </div>
      <Link
        href="/studio?tool=chat"
        onClick={onClose}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[8px] font-black uppercase tracking-[.12em] transition-colors hover:bg-white/5"
        style={{
          borderColor: `${T.accentColor}35`,
          backgroundColor: `${T.accentColor}12`,
          color: T.headerColor,
        }}
      >
        <Sparkles size={10} /> Ask LiTT anything
      </Link>
    </section>
  );
}
