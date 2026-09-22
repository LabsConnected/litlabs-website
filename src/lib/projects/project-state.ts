/**
 * Honest project-state presentation for the /projects page.
 *
 * Pure helpers (no React) so the badge copy, staleness logic, and
 * recent-first ordering can be unit-tested independently of the page.
 *
 * Badge palette is intentionally limited: red (broken), amber (in
 * progress / stuck), green/lime (healthy), gray (not started). No
 * blue/purple/cyan/pink drift — lime is the brand accent.
 */

export const STALE_PROVISIONING_MS = 30 * 60 * 1000; // 30 minutes

export const LAST_OPENED_PROJECT_KEY = "litt:last-opened-project";

export type ProjectStateInput = {
  workspaceStatus: string;
  runtimeStatus: string;
  updatedAt: string;
  workspaceError?: string | null;
  runtimeError?: string | null;
};

export type ProjectStateDescription = {
  /** Badge text, e.g. "Setup failed". */
  label: string;
  /** Badge hex color (from the allowed palette). */
  color: string;
  /** One-line explanation of what needs attention, or null when nothing is wrong. */
  detail: string | null;
  /** Whether a "Retry setup" action is offered (POST workspace/prepare). */
  canRetry: boolean;
};

const RED = "#f87171";
const AMBER = "#fbbf24";
const GREEN = "#34d399";
const LIME = "#a3e635";
const GRAY = "#9ca3af";

/** Every badge color this module can return. Tests assert nothing else leaks in. */
export const BADGE_PALETTE = [RED, AMBER, GREEN, LIME, GRAY] as const;

function isStale(updatedAt: string, nowMs: number): boolean {
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return false;
  return nowMs - ts > STALE_PROVISIONING_MS;
}

export function describeProjectState(
  project: ProjectStateInput,
  nowMs: number = Date.now(),
): ProjectStateDescription {
  const ws = project.workspaceStatus;
  const rt = project.runtimeStatus;

  if (["failed", "error"].includes(ws)) {
    return {
      label: "Setup failed",
      color: RED,
      detail: project.workspaceError
        ? `Setup failed: ${project.workspaceError}`
        : "Workspace setup failed before it finished. Your project is safe.",
      canRetry: true,
    };
  }

  if (rt === "failed") {
    return {
      label: "Preview failed",
      color: RED,
      detail: project.runtimeError
        ? `Preview failed: ${project.runtimeError}`
        : "The preview failed to start. Your files are safe — open the project to try again.",
      canRetry: false,
    };
  }

  if (["provisioning", "preparing"].includes(ws) || rt === "starting") {
    if (isStale(project.updatedAt, nowMs)) {
      return {
        label: "Stalled",
        color: AMBER,
        detail:
          "Setup has been stuck for a while. Retry to pick it back up.",
        canRetry: true,
      };
    }
    return { label: "Preparing", color: AMBER, detail: null, canRetry: false };
  }

  if (ws === "ready" && rt === "ready") {
    return { label: "Preview ready", color: GREEN, detail: null, canRetry: false };
  }

  if (ws === "ready") {
    return { label: "Ready", color: LIME, detail: null, canRetry: false };
  }

  return { label: "Setup needed", color: GRAY, detail: null, canRetry: false };
}

/** Newest first by updatedAt; unparseable dates sink to the bottom. */
export function sortProjectsRecentFirst<
  T extends { updatedAt: string },
>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    const va = Number.isNaN(ta) ? -Infinity : ta;
    const vb = Number.isNaN(tb) ? -Infinity : tb;
    return vb - va;
  });
}

export function readLastOpenedProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_OPENED_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function recordLastOpenedProject(id: string): void {
  try {
    window.localStorage.setItem(LAST_OPENED_PROJECT_KEY, id);
  } catch {
    // Private mode / blocked storage — the Resume affordance just won't stick.
  }
}
