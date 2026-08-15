"use client";

/**
 * ProjectTypeSelector — the CREATE TYPE dropdown at the top of the
 * left panel. Lets the user switch between Website, HTML/CSS/JS,
 * 2D Game, 3D Game, Web App, and Component modes.
 *
 * Changing the type switches the entire workspace context:
 *   - Website/App/Component → visual Canvas builder
 *   - HTML/CSS/JS → file editor + live preview
 *   - Game → game builder (Phase 2)
 */

import { useState, useRef, useEffect } from "react";
import {
  Globe,
  Code2,
  Gamepad2,
  Box,
  AppWindow,
  Component,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import { PROJECT_TYPES, type ProjectType, type ProjectTypeMeta } from "./projectTypes";
import { useConnectionSummary } from "@/app/(app)/studio/hooks/useConnectionSummary";

const ICONS: Record<string, LucideIcon> = {
  Globe,
  Code2,
  Gamepad2,
  Box,
  AppWindow,
  Component,
};

export function ProjectTypeSelector() {
  const projectType = useCanvasBuilderStore((s) => s.projectType);
  const setProjectType = useCanvasBuilderStore((s) => s.setProjectType);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Server-backed project ID for persisting workspace type
  const { capabilities } = useConnectionSummary();
  const projectId = capabilities.projectId ?? null;

  const current = PROJECT_TYPES.find((p) => p.id === projectType) ?? PROJECT_TYPES[0];
  const CurrentIcon = ICONS[current.icon] ?? Globe;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSelect = (type: ProjectType) => {
    setProjectType(type);
    setOpen(false);
    // Persist to server so it survives logout/login and is shared across devices
    if (projectId) {
      fetch(`/api/studio-projects/${projectId}/workspace-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceType: type }),
      }).catch(() => {
        // Non-fatal — localStorage still has the type as fallback
      });
    }
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
        style={{
          borderBottom: "1px solid var(--glass-border)",
          background: open ? "rgba(255,255,255,0.04)" : "transparent",
        }}
      >
        <CurrentIcon size={16} style={{ color: "var(--glass-purple)" }} />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-black uppercase tracking-[0.1em]" style={{ color: "var(--glass-text-3)" }}>
            Build Type
          </div>
          <div className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {current.label}
          </div>
        </div>
        <ChevronDown
          size={14}
          style={{
            color: "var(--glass-text-3)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 overflow-y-auto"
          style={{
            maxHeight: "min(70vh, 480px)",
            background: "var(--studio-bg, #1a1a1a)",
            border: "1px solid var(--studio-border-strong, #333)",
            borderRadius: 12,
            marginTop: 4,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em]" style={{ color: "var(--glass-text-3)" }}>
            Create Type
          </div>
          {PROJECT_TYPES.map((meta) => {
            const Icon = ICONS[meta.icon] ?? Globe;
            const isActive = meta.id === projectType;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => handleSelect(meta.id)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{
                  background: isActive ? "rgba(155,77,255,0.08)" : "transparent",
                }}
              >
                <Icon
                  size={18}
                  style={{
                    color: isActive ? "var(--glass-purple)" : "var(--glass-text-3)",
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-semibold"
                      style={{ color: isActive ? "var(--glass-purple)" : "var(--text-primary)" }}
                    >
                      {meta.label}
                    </span>
                    {isActive && (
                      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--glass-purple)" }}>
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--glass-text-3)" }}>
                    {meta.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
