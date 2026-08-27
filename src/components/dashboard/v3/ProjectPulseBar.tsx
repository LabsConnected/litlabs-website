"use client";

/**
 * ProjectPulseBar — thin dev status strip below the header.
 *
 * Shows real deployment/build/test/branch/commit/terminal status.
 * Clickable items open the developer drawer. Never fakes green checks.
 */

import type { PulseItem } from "./types";

interface ProjectPulseBarProps {
  items: PulseItem[];
  loading: boolean;
  onItemClick: (item: PulseItem) => void;
}

const STATE_COLORS: Record<PulseItem["state"], string> = {
  live: "#34d399",
  passing: "#34d399",
  building: "#f59e0b",
  failed: "#ef4444",
  unknown: "#71717a",
  idle: "#a1a1aa",
};

export function ProjectPulseBar({ items, loading, onItemClick }: ProjectPulseBarProps) {
  return (
    <div
      className="flex h-8 w-full items-center gap-3 overflow-x-auto border-b px-4 text-xs font-mono md:gap-6 md:px-6"
      style={{
        background: "rgba(10,10,10,0.6)",
        borderColor: "rgba(255,255,255,0.04)",
      }}
    >
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: "#71717a" }}>
          <div
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: "#71717a" }}
          />
          Loading status…
        </div>
      ) : items.length === 0 ? (
        <span style={{ color: "#71717a" }}>No project connected</span>
      ) : (
        items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-3 md:gap-6">
            {idx > 0 && (
              <div
                className="h-3 w-px shrink-0"
                style={{ background: "rgba(255,255,255,0.06)" }}
              />
            )}
            <button
              onClick={() => item.clickable && onItemClick(item)}
              disabled={!item.clickable}
              className="flex shrink-0 items-center gap-1.5 transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-100"
              style={{
                color: STATE_COLORS[item.state],
              }}
              title={item.detail || item.label}
            >
              {item.state === "live" || item.state === "passing" ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: STATE_COLORS[item.state],
                    boxShadow: `0 0 4px ${STATE_COLORS[item.state]}80`,
                  }}
                />
              ) : item.state === "building" ? (
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ background: STATE_COLORS[item.state] }}
                />
              ) : item.state === "failed" ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STATE_COLORS[item.state] }}
                />
              ) : (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: STATE_COLORS[item.state],
                    opacity: 0.5,
                  }}
                />
              )}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          </div>
        ))
      )}
    </div>
  );
}
