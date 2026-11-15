"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";

/**
 * Settings primitives — shared building blocks for every /settings
 * section. Colors bind to the applied theme's tokens (the same
 * useTheme pattern Discover and the Studio shell chrome use): card
 * surfaces follow tokens.surface, hairlines tokens.border, headings
 * tokens.text, secondary copy tokens.textMuted. In the default
 * light LiTT Signature theme those tokens resolve to the approved
 * light look (white cards, deep-green ink) the sections render
 * inside LiTTAppShell; in Dark mode the same components paint the
 * skin's dark surfaces (Signature: Larry's charcoal) instead of
 * staying hard-coded white — the patchwork defect of 2026-11-14.
 */
export function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
    >
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <div>
          <h3 className="text-sm font-bold" style={{ color: tokens.text }}>{title}</h3>
          {description && <p className="mt-0.5 text-xs" style={{ color: tokens.textMuted }}>{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  const { tokens } = useTheme();
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-black tracking-tight" style={{ color: tokens.text }}>{title}</h1>
      {description && <p className="mt-1 text-[13px]" style={{ color: tokens.textMuted }}>{description}</p>}
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  icon,
  onConfigure,
  configureLabel,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: ReactNode;
  onConfigure?: () => void;
  configureLabel?: string;
}) {
  const { tokens } = useTheme();
  return (
    <label
      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer"
      style={{ borderColor: tokens.border, backgroundColor: `${tokens.text}0A` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0" style={{ color: tokens.textMuted }}>{icon}</span>}
        <div className="min-w-0">
          <p className="text-xs font-bold truncate" style={{ color: tokens.text }}>{title}</p>
          {description && <p className="text-[9px] truncate" style={{ color: tokens.textMuted }}>{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onConfigure && configureLabel && (
          <button
            type="button"
            onClick={onConfigure}
            className="text-[9px] font-bold text-accent hover:text-accent-strong"
          >
            {configureLabel}
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-black/20"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4.5" : "left-0.5"}`}
          />
        </button>
      </div>
    </label>
  );
}

export function SettingsInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const { tokens } = useTheme();
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-accent/40"
        style={{ backgroundColor: tokens.surface, borderColor: tokens.border, color: tokens.text }}
      />
    </label>
  );
}

export function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[9px] font-bold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  );
}
