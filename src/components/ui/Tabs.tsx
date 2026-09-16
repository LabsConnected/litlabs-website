"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  /** Optional badge content (e.g. a count). */
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Uncontrolled initial tab. */
  defaultValue?: string;
  /** Controlled selected tab. */
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
}

/**
 * Accessible tabs: roving tabindex, ArrowLeft/Right + Home/End navigation,
 * aria-selected / aria-controls wiring. Panels are rendered by the caller via
 * `TabsPanel` or by reading the selected value.
 */
export function Tabs({ tabs, defaultValue, value, onChange, className }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const selected = value ?? internal;

  const select = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.disabled) return;
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  const focusTab = (index: number) => {
    const el = tabRefs.current[index];
    el?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    // Skip disabled tabs.
    let guard = 0;
    while (tabs[next].disabled && guard < tabs.length) {
      next = e.key === "ArrowLeft" || e.key === "End" ? (next - 1 + tabs.length) % tabs.length : (next + 1) % tabs.length;
      guard++;
    }
    select(tabs[next].id);
    focusTab(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Tabs"
      className={cn(
        "flex gap-1 overflow-x-auto rounded-xl border border-white/12 bg-white/5 p-1",
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={isSelected}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={isSelected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
              "transition-colors duration-200 motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
              isSelected
                ? "bg-cyan-400/15 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]"
                : "text-white/60 hover:bg-white/10 hover:text-white",
              tab.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/60",
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabsPanel({
  id,
  labelledBy,
  hidden,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  hidden?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      hidden={hidden}
      className={cn("pt-4", className)}
    >
      {!hidden && children}
    </div>
  );
}
