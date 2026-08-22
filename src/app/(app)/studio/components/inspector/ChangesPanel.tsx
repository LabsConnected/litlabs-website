"use client";

import { studioColors, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import { StudioPanel } from "../primitives/StudioPanel";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import type { ChangedFilesSummary } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ChangesPanel — Inspector tab: Changes.
 *
 * Explains code mutations. Shows changed files with add/modify/delete
 * counts, file paths, and diff navigation.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface ChangesPanelProps {
  changes: ChangedFilesSummary;
  /** Whether there are uncommitted working tree changes */
  workingTreeDirty: boolean;
  loading?: boolean;
  onFileClick?: (path: string) => void;
}

export function ChangesPanel({ changes, workingTreeDirty, loading, onFileClick }: ChangesPanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="changes-panel-loading">Loading changes…</div>;
  }

  if (changes.total === 0) {
    return (
      <StudioEmptyState
        title="No changes yet"
        description="When LiTT edits files, changed files will appear here with diffs."
        testId="changes-panel-empty"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[6] }} data-testid="changes-panel">
      <StudioPanel title="Summary" testId="changes-summary-panel">
        <div style={{
          display: "flex",
          gap: studioSpacing[12],
          fontSize: studioTypography.md,
        }}>
          <span style={{ color: studioColors.green }}>
            +{changes.added} added
          </span>
          <span style={{ color: studioColors.amber }}>
            ~{changes.modified} modified
          </span>
          <span style={{ color: studioColors.red }}>
            -{changes.deleted} deleted
          </span>
        </div>
        {workingTreeDirty && (
          <div style={{
            marginTop: studioSpacing[4],
            fontSize: studioTypography.sm,
            color: studioColors.amber,
          }}>
            Working tree has uncommitted changes
          </div>
        )}
      </StudioPanel>

      <StudioPanel title={`Changed Files (${changes.total})`} testId="changes-files-panel">
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {changes.paths.map((path) => (
            <li key={path}>
              <button
                onClick={() => onFileClick?.(path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: studioSpacing[4],
                  width: "100%",
                  padding: `${studioSpacing[2]} 0`,
                  background: "transparent",
                  border: "none",
                  color: studioColors.textSecondary,
                  fontSize: studioTypography.sm,
                  fontFamily: studioTypography.mono,
                  cursor: onFileClick ? "pointer" : "default",
                  textAlign: "left",
                  borderBottom: `1px solid ${studioColors.borderNeutral}`,
                }}
                data-testid={`changes-file-${path}`}
              >
                <span style={{ color: studioColors.textMuted, flexShrink: 0 }}>○</span>
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {path}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </StudioPanel>
    </div>
  );
}
