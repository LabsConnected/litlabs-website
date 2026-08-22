"use client";

import { studioColors, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import type { BlockingReason } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ReviewBlockingReasons — lists why review cannot proceed.
 *
 * Phase 10.5 — Review experience
 * ───────────────────────────────────────────────────────────────── */

interface ReviewBlockingReasonsProps {
  blockers: BlockingReason[];
}

function categoryIcon(category: BlockingReason["category"]): string {
  switch (category) {
    case "checks": return "✗";
    case "acceptance": return "✗";
    case "stale": return "⚠";
    case "approval": return "⏸";
    case "mutations": return "○";
    case "events": return "⚠";
    default: return "⚠";
  }
}

function categoryColor(category: BlockingReason["category"]): string {
  switch (category) {
    case "checks":
    case "acceptance":
      return studioColors.red;
    case "stale":
    case "approval":
      return studioColors.amber;
    case "mutations":
      return studioColors.textMuted;
    case "events":
    default:
      return studioColors.amber;
  }
}

export function ReviewBlockingReasons({ blockers }: ReviewBlockingReasonsProps) {
  if (blockers.length === 0) return null;

  return (
    <div data-testid="review-blocking-reasons" style={{
      display: "flex",
      flexDirection: "column",
      gap: studioSpacing[2],
    }}>
      <div style={{
        fontSize: studioTypography.xs,
        fontWeight: 700,
        color: studioColors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: studioSpacing[2],
      }}>
        Blocking Reasons ({blockers.length})
      </div>
      {blockers.map((blocker, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: studioSpacing[4],
            padding: `${studioSpacing[4]} ${studioSpacing[6]}`,
            borderRadius: "6px",
            background: studioColors.card,
            border: `1px solid ${studioColors.borderNeutral}`,
          }}
          data-testid={`blocking-reason-${i}`}
        >
          <span style={{
            color: categoryColor(blocker.category),
            fontSize: studioTypography.sm,
            flexShrink: 0,
            fontWeight: 700,
          }}>
            {categoryIcon(blocker.category)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: studioTypography.md,
              color: studioColors.textPrimary,
              lineHeight: 1.4,
            }}>
              {blocker.reason}
            </div>
            <div style={{
              fontSize: studioTypography.xs,
              color: studioColors.textMuted,
              marginTop: studioSpacing[1],
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              {blocker.category}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
