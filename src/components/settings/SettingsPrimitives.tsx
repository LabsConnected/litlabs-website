"use client";

import type { ReactNode } from "react";

export type SaveStatus = "idle" | "saving" | "saved";

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
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-cyan-300">{icon}</span>}
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {description && <p className="text-[10px] text-white/40">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-black text-white">{title}</h1>
      {description && <p className="text-xs text-white/40">{description}</p>}
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
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 cursor-pointer">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-white/40 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{title}</p>
          {description && <p className="text-[9px] text-white/35 truncate">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onConfigure && configureLabel && (
          <button
            type="button"
            onClick={onConfigure}
            className="text-[9px] font-bold text-cyan-300 hover:text-cyan-200"
          >
            {configureLabel}
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-cyan-400" : "bg-white/15"}`}
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
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/40"
      />
    </label>
  );
}

export function SaveBar({
  status,
  onSave,
  onDiscard,
  hasChanges,
}: {
  status: SaveStatus;
  onSave: () => void;
  onDiscard: () => void;
  hasChanges: boolean;
}) {
  if (!hasChanges && status === "idle") return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-black/80 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
      {status === "saving" && <span className="text-xs text-white/60">Saving…</span>}
      {status === "saved" && <span className="text-xs text-green-400">Saved</span>}
      {status === "idle" && (
        <>
          <button onClick={onDiscard} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white/50 hover:bg-white/8 hover:text-white">
            Discard
          </button>
          <button onClick={onSave} className="rounded-lg bg-cyan-400 px-4 py-1.5 text-xs font-black text-slate-950">
            Save changes
          </button>
        </>
      )}
    </div>
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
