"use client";

/**
 * Studio shell workspace rail — one click = one workspace.
 * The design workspace stays pinned to the top; LiTT stays out of the way.
 */

import {
  Activity,
  Box,
  Code2,
  Files,
  Globe,
  Image as ImageIcon,
  Palette,
  Rocket,
} from "lucide-react";
import { useStudioShell, type WorkspaceId } from "./StudioShellContext";

const RAIL_ITEMS: { id: WorkspaceId; label: string; icon: typeof Globe; badge?: boolean }[] = [
  { id: "design", label: "Design", icon: Palette },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "code", label: "Code", icon: Code2 },
  { id: "files", label: "Files", icon: Files },
  { id: "assets", label: "Assets", icon: Box },
  { id: "deploy", label: "Deploy", icon: Rocket },
  { id: "activity", label: "Activity", icon: Activity },
];

export function WorkspaceRail() {
  const { workspace, selectWorkspace } = useStudioShell();

  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-2"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      aria-label="Workspaces"
      data-testid="studio-workspace-rail"
    >
      {RAIL_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = workspace === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => selectWorkspace(id)}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-xl transition"
            style={
              active
                ? {
                    backgroundColor: "rgba(163,230,53,0.12)",
                    color: "var(--litt-primary)",
                    border: "1px solid rgba(163,230,53,0.35)",
                  }
                : { color: "var(--text-muted)", border: "1px solid transparent" }
            }
          >
            <Icon size={17} />
            <span className="text-[8px] font-bold leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
