/**
 * CommandSurface — the visual + interaction center of the idle cockpit
 * (spec §2/§13/§60).
 *
 *   ▌ Ask LiTT anything...
 *   │
 *   ├──────────────────────────────────────────────
 *   │ Build  ·  GPT-5.6 Sol  ·  Homebase-3.0
 *
 * Dark/default terminal surface, brand left accent border (▌), subtle
 * gray divider, input consumes the majority width, context footer row
 * beneath the input. No loud backgrounds.
 *
 * The surface wraps the existing CommandDock (which owns the actual
 * TextInput + keyboard). This component only adds the accent border,
 * the context footer, and responsive truncation.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { LayoutBand } from "./use-terminal-size.js";

export interface CommandSurfaceProps {
  /** The wrapped input element (CommandDock). */
  children: React.ReactNode;
  /** Context footer segments, e.g. ["Build", "GPT-5.6 Sol", "Homebase-3.0"]. */
  contextSegments: Array<{ label: string; color?: string }>;
  band: LayoutBand;
  /** Available width for the surface. */
  width: number;
}

/** Truncate a string to fit, with ellipsis. */
function trunc(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(1, max - 1)) + "…";
}

export function CommandSurface({ children, contextSegments, band, width }: CommandSurfaceProps): React.ReactElement {
  // Inner content width minus the accent border column and padding.
  const innerWidth = Math.max(20, width - 4);

  // Build the context footer: "Build  ·  Model  ·  Project"
  // Truncate segments proportionally if narrow.
  const separator = "  ·  ";
  const fullFooter = contextSegments.map((s) => s.label).join(separator);
  const footer = trunc(fullFooter, innerWidth);

  return (
    <Box flexDirection="column">
      {/* Accent border + input */}
      <Box>
        <Text color={COLORS.brand} bold>{"▌ "}</Text>
        <Box flexGrow={1} flexDirection="column">
          {children}
        </Box>
      </Box>

      {/* Divider + context footer */}
      <Box>
        <Text color={COLORS.brand}>{"├"}</Text>
        <Text color={COLORS.secondary}>{"─".repeat(Math.max(2, innerWidth))}</Text>
      </Box>
      <Box>
        <Text color={COLORS.brand}>{"│ "}</Text>
        <Text color={COLORS.secondary}>{footer}</Text>
      </Box>

      {band === "narrow" && (
        <Box>
          <Text color={COLORS.brand}>{"│"}</Text>
        </Box>
      )}
    </Box>
  );
}
