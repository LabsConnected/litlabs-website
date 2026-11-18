"use client";

/**
 * Real project-type detection for board mode (plan §2 B3).
 *
 * The board's default panel set depends on the project type (Larry's
 * project-type panel sets addition): game projects open with the World
 * and Media panels, website projects do not. CommandStudio used to
 * hardcode "website" — this hook reads the project's real type from the
 * same source the canvas builder already trusts: the project's stored
 * `workspaceType` ("website" | "html" | "game2d" | "game3d" | "app" |
 * "component"), served by GET /api/studio-projects/:id.
 *
 * Unknown / still-loading / fetch failure resolves to "website" — the
 * long-standing default — never to a guessed game layout.
 */

import { useEffect, useState } from "react";
import type { BoardProjectType } from "./board-types";

/** Map a stored workspaceType onto the board's two layout families. */
export function boardProjectTypeForWorkspaceType(workspaceType: unknown): BoardProjectType {
  return workspaceType === "game2d" || workspaceType === "game3d" ? "game" : "website";
}

export function useBoardProjectType(projectId: string | null | undefined): BoardProjectType {
  const [projectType, setProjectType] = useState<BoardProjectType>("website");

  useEffect(() => {
    // A project switch starts from the website default until the real
    // type lands — the layout store records the correction via
    // ensureScope when it arrives (panels are kept, type is updated).
    setProjectType("website");
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setProjectType(boardProjectTypeForWorkspaceType(data?.project?.workspaceType));
        }
      } catch {
        // Non-fatal — the website default stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return projectType;
}
