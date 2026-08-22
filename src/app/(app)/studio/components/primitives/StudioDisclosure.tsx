"use client";

import { type ReactNode, useState } from "react";
import { studioColors, studioSpacing, studioMotion } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioDisclosure — expandable/collapsible section.
 *
 * Used to keep raw evidence and logs under Details.
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

interface StudioDisclosureProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}

export function StudioDisclosure({ label, children, defaultOpen = false, testId }: StudioDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-testid={testId ?? "studio-disclosure"}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[2],
          background: "transparent",
          border: "none",
          color: studioColors.textMuted,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
        aria-expanded={open}
      >
        <span
          style={{
            transition: `transform ${studioMotion.fast} ${studioMotion.ease}`,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: 8,
          }}
        >
          ▶
        </span>
        {label}
      </button>
      {open && (
        <div style={{ marginTop: studioSpacing[4] }}>
          {children}
        </div>
      )}
    </div>
  );
}
