"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Icon } from "./dashboard-v2-utils";
import { STATUS_COLORS } from "./dashboard-v2-utils";

export function Card({
  title,
  icon,
  action,
  children,
  colSpan = "lg:col-span-8",
}: {
  title: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  colSpan?: string;
}) {
  const T = useTheme().resolvedColors;
  return (
    <section className={colSpan}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] opacity-50">
          {icon && <Icon name={icon} size={13} />}
          {title}
        </h2>
        {action}
      </div>
      <div
        className="rounded-2xl p-4 lg:p-5"
        style={{
          background: `${T.boxBg}90`,
          border: `1px solid ${T.borderColor}30`,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function SkeletonCard() {
  return (
    <div
      className="rounded-2xl p-4 animate-pulse"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div className="h-4 w-32 rounded bg-white/5 mb-3" />
      <div className="h-3 w-48 rounded bg-white/5 mb-2" />
      <div className="h-3 w-24 rounded bg-white/5 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 w-20 rounded bg-white/5" />
        <div className="h-6 w-20 rounded bg-white/5" />
      </div>
    </div>
  );
}

export function ActionButton({
  href,
  label,
  primary,
  color,
  icon,
}: {
  href: string;
  label: string;
  primary?: boolean;
  color?: string;
  icon?: string;
}) {
  const T = useTheme().resolvedColors;
  const c = color || T.accentColor;
  if (primary) {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.02]"
        style={{ background: c, color: T.bgColor }}
      >
        {icon && <Icon name={icon} size={14} />}
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-80"
      style={{
        background: `${c}20`,
        color: c,
        border: `1px solid ${c}30`,
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {label}
    </Link>
  );
}

export function ConnectionPulse({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "connected" ||
      status === "synced" ||
      status === "ready" ? (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  color,
}: {
  icon: string;
  title: string;
  message: string;
  action?: ReactNode;
  color?: string;
}) {
  const T = useTheme().resolvedColors;
  const c = color || T.accentColor;
  return (
    <div className="py-5 text-center">
      <div
        className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: `${c}10`, border: `1px solid ${c}20` }}
      >
        <Icon name={icon} size={18} style={{ color: c }} />
      </div>
      <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>
        {title}
      </p>
      <p className="text-xs opacity-50 mb-3">{message}</p>
      {action}
    </div>
  );
}
