"use client";

import type { ReactNode } from "react";

/**
 * Settings primitives — shared building blocks for every /settings
 * section. Colors follow the platform's all-light standard (the same
 * light look as the LiTTAppShell frame the sections render inside):
 * white cards, dark zinc text, black-alpha borders and washes. These
 * components used to carry dark-theme-era colors (bg-black/30 cards,
 * text-white headings), which rendered white-on-white inside the
 * light shell — the headings and card text were invisible.
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
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <div>
          <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-black tracking-tight text-zinc-900">{title}</h1>
      {description && <p className="mt-1 text-[13px] text-zinc-500">{description}</p>}
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
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-black/[0.07] bg-black/[0.02] px-3 py-2.5 cursor-pointer">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-zinc-400 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-900 truncate">{title}</p>
          {description && <p className="text-[9px] text-zinc-500 truncate">{description}</p>}
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
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-accent/40"
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
