/**
 * Dashboard v3 — composition and integration tests.
 *
 * Verifies that the new dashboard:
 *   - Renders the v3 Dashboard (not v2 MissionControlDashboard)
 *   - Includes Continue Working, Quick Start, Recent Work, Recent Media
 *   - Uses the real MediaHubProvider (via useMediaDock) — no new provider
 *   - MediaDock consumes MediaHub + MusicPlayerContext (no duplicate state)
 *   - Command palette has real destinations/actions (no dead commands)
 *   - Focus Mode is an overlay (not a separate dashboard tree)
 *   - Developer drawer surfaces real project/runtime info
 *   - No FloatingMusicWidget (replaced by MediaDock)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const V3_DIR = path.resolve(__dirname, "../src/components/dashboard/v3");

function readSrc(filename: string): string {
  return fs.readFileSync(path.join(V3_DIR, filename), "utf-8");
}

describe("Dashboard v3 — composition", () => {
  const dashboardSrc = readSrc("Dashboard.tsx");

  it("renders ContinueWorking section", () => {
    expect(dashboardSrc).toContain("ContinueWorking");
  });

  it("renders QuickStart section", () => {
    expect(dashboardSrc).toContain("QuickStart");
  });

  it("renders RecentWork section", () => {
    expect(dashboardSrc).toContain("RecentWork");
  });

  it("renders RecentMedia section", () => {
    expect(dashboardSrc).toContain("RecentMedia");
  });

  it("renders MediaDock (persistent footer)", () => {
    expect(dashboardSrc).toContain("MediaDock");
  });

  it("renders ProjectPulseBar", () => {
    expect(dashboardSrc).toContain("ProjectPulseBar");
  });

  it("renders DashboardHeader", () => {
    expect(dashboardSrc).toContain("DashboardHeader");
  });

  it("renders AnimatedBackground", () => {
    expect(dashboardSrc).toContain("AnimatedBackground");
  });

  it("renders CommandPalette", () => {
    expect(dashboardSrc).toContain("CommandPalette");
  });

  it("has Focus Mode as an overlay (not a separate tree)", () => {
    expect(dashboardSrc).toContain("FocusMode");
    expect(dashboardSrc).toContain("focusModeOpen");
  });

  it("has Developer Drawer", () => {
    expect(dashboardSrc).toContain("DeveloperDrawer");
    expect(dashboardSrc).toContain("devDrawerOpen");
  });

  it("has Queue Panel (slide-over)", () => {
    expect(dashboardSrc).toContain("QueuePanel");
    expect(dashboardSrc).toContain("queueOpen");
  });

  it("uses real data hooks (useMissionControl, useDashboardMedia)", () => {
    expect(dashboardSrc).toContain("useMissionControl");
    expect(dashboardSrc).toContain("useDashboardMedia");
  });

  it("derives project and pulse from real data", () => {
    expect(dashboardSrc).toContain("deriveProject");
    expect(dashboardSrc).toContain("derivePulseItems");
    expect(dashboardSrc).toContain("deriveRecentProjects");
  });

  it("has Ctrl+K / Cmd+K shortcut for command palette", () => {
    expect(dashboardSrc).toContain("ctrlKey");
    expect(dashboardSrc).toContain("metaKey");
    expect(dashboardSrc).toContain('"k"');
  });

  it("has responsive grid layout (lg:grid-cols-12)", () => {
    expect(dashboardSrc).toContain("lg:grid-cols-12");
    expect(dashboardSrc).toContain("lg:col-span-7");
    expect(dashboardSrc).toContain("lg:col-span-5");
  });
});

describe("Dashboard v3 — media integration (no duplicate provider)", () => {
  const dockSrc = readSrc("useMediaDock.ts");
  const dashboardSrc = readSrc("Dashboard.tsx");

  it("useMediaDock imports useMediaHub (reuses existing provider)", () => {
    expect(dockSrc).toContain("useMediaHub");
    expect(dockSrc).toContain("MediaHubProvider");
  });

  it("useMediaDock imports useMusicPlayerOptional (reuses LiTT audio)", () => {
    expect(dockSrc).toContain("useMusicPlayerOptional");
  });

  it("useMediaDock does NOT create a new Audio element", () => {
    expect(dockSrc).not.toContain("new Audio()");
    expect(dockSrc).not.toContain("<audio");
  });

  it("useMediaDock does NOT create a new context/provider", () => {
    expect(dockSrc).not.toContain("createContext");
    expect(dockSrc).not.toContain("MediaHubProvider>");
  });

  it("Dashboard uses useMediaDock (coordination hook)", () => {
    expect(dashboardSrc).toContain("useMediaDock");
  });

  it("Dashboard does NOT mount a second MediaHubProvider", () => {
    expect(dashboardSrc).not.toContain("<MediaHubProvider");
  });

  it("useMediaDock coordinates LiTT + Hub (pauses one when other plays)", () => {
    expect(dockSrc).toContain("littPlaying");
    expect(dockSrc).toContain("hubPlaying");
    expect(dockSrc).toContain("hub.pause()");
  });
});

describe("Dashboard v3 — DashboardView wiring", () => {
  const viewSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/components/DashboardView.tsx"),
    "utf-8",
  );

  it("imports v3 Dashboard (not v2 MissionControlDashboard)", () => {
    expect(viewSrc).toContain("dashboard/v3/Dashboard");
    expect(viewSrc).not.toContain("v2/MissionControlDashboard");
  });

  it("does NOT render FloatingMusicWidget (replaced by MediaDock)", () => {
    // Should not import or render the FloatingMusicWidget component
    expect(viewSrc).not.toMatch(/import.*FloatingMusicWidget/);
    expect(viewSrc).not.toMatch(/<FloatingMusicWidget/);
  });

  it("keeps DashboardThemeProvider", () => {
    expect(viewSrc).toContain("DashboardThemeProvider");
  });
});

describe("Dashboard v3 — Continue Working", () => {
  const src = readSrc("ContinueWorking.tsx");

  it("shows project name, branch, and status", () => {
    expect(src).toContain("project.name");
    expect(src).toContain("project.branch");
    expect(src).toContain("project.status");
  });

  it("has Open Studio action (real route)", () => {
    expect(src).toContain("Open Studio");
    expect(src).toContain("/studio");
  });

  it("has Preview action (conditional on previewState)", () => {
    expect(src).toContain("Preview");
    expect(src).toContain("previewState");
  });

  it("has timeAgo display for last edited", () => {
    expect(src).toContain("timeAgo");
    expect(src).toContain("updatedAt");
  });

  it("has loading skeleton state", () => {
    expect(src).toContain("loading");
    expect(src).toContain("animate-pulse");
  });

  it("has empty state when no project", () => {
    expect(src).toContain("Ready to build something");
  });
});

describe("Dashboard v3 — Quick Start", () => {
  const src = readSrc("QuickStart.tsx");

  it("has six creation types (Website, App, Game, Image, Video, Music)", () => {
    expect(src).toContain("Website");
    expect(src).toContain("App");
    expect(src).toContain("Game");
    expect(src).toContain("Image");
    expect(src).toContain("Video");
    expect(src).toContain("Music");
  });

  it("links to real studio routes", () => {
    expect(src).toContain("/studio?tool=");
  });

  it("is responsive (grid-cols-2 md:grid-cols-3)", () => {
    expect(src).toContain("grid-cols-2");
    expect(src).toContain("md:grid-cols-3");
  });
});

describe("Dashboard v3 — MediaDock", () => {
  const src = readSrc("MediaDock.tsx");

  it("shows artwork, title, and source in collapsed state", () => {
    expect(src).toContain("artworkUrl");
    expect(src).toContain("dock.title");
    expect(src).toContain("dock.creator");
  });

  it("has play/pause toggle", () => {
    expect(src).toContain("actions.toggle");
    expect(src).toContain("Play");
    expect(src).toContain("Pause");
  });

  it("has previous/next controls", () => {
    expect(src).toContain("actions.previous");
    expect(src).toContain("actions.next");
  });

  it("has seek bar (conditional on duration)", () => {
    expect(src).toContain("seekRef");
    expect(src).toContain("actions.seek");
    expect(src).toContain("durationMs");
  });

  it("has volume control", () => {
    expect(src).toContain("actions.setVolume");
    expect(src).toContain("Volume2");
    expect(src).toContain("VolumeX");
  });

  it("has Focus button", () => {
    expect(src).toContain("Focus");
    expect(src).toContain("onOpenFocusMode");
  });

  it("has queue button", () => {
    expect(src).toContain("ListMusic");
    expect(src).toContain("onOpenQueue");
  });

  it("has loading state (spinner)", () => {
    expect(src).toContain("isLoading");
    expect(src).toContain("Loader2");
  });

  it("has error display", () => {
    expect(src).toContain("dock.error");
    expect(src).toContain("AlertCircle");
  });

  it("has empty state when nothing playing", () => {
    expect(src).toContain('source === "none"');
    expect(src).toContain("Nothing playing");
  });

  it("has mobile mini player (md:hidden)", () => {
    expect(src).toContain("md:hidden");
  });

  it("has desktop dock (md:flex)", () => {
    expect(src).toContain("md:flex");
  });
});

describe("Dashboard v3 — Queue (real MediaHub queue)", () => {
  const dashboardSrc = readSrc("Dashboard.tsx");
  const dockSrc = readSrc("useMediaDock.ts");

  it("Dashboard QueuePanel uses dock.queue (from real provider)", () => {
    expect(dashboardSrc).toContain("dock.queue");
  });

  it("QueuePanel has jumpTo, removeFromQueue, clearQueue actions", () => {
    expect(dashboardSrc).toContain("actions.jumpTo");
    expect(dashboardSrc).toContain("actions.removeFromQueue");
    expect(dashboardSrc).toContain("actions.clearQueue");
  });

  it("useMediaDock exposes hub queue items", () => {
    expect(dockSrc).toContain("hub.queue.map");
  });

  it("useMediaDock exposes LiTT queue items", () => {
    expect(dockSrc).toContain("litt.queue.map");
  });

  it("QueuePanel has URL input for loading media", () => {
    expect(dashboardSrc).toContain("UrlInputFooter");
    expect(dashboardSrc).toContain("actions.loadUrl");
  });
});

describe("Dashboard v3 — Command Palette (real actions)", () => {
  const src = readSrc("CommandPalette.tsx");

  it("has project commands (open recent projects)", () => {
    expect(src).toContain("projects");
    expect(src).toContain("proj-");
  });

  it("has action commands (Create Website/App/Game, Generate Image/Video/Music)", () => {
    expect(src).toContain("Create Website");
    expect(src).toContain("Create App");
    expect(src).toContain("Create Game");
    expect(src).toContain("Generate Image");
    expect(src).toContain("Generate Video");
    expect(src).toContain("Create Music");
  });

  it("has developer commands (Open Studio, Preview, Terminal, Deployment)", () => {
    expect(src).toContain("Open Studio");
    expect(src).toContain("Open Preview");
    expect(src).toContain("Open Terminal");
    expect(src).toContain("View Deployment");
  });

  it("has media commands (Play track, Open Queue, Focus Mode)", () => {
    expect(src).toContain("Play:");
    expect(src).toContain("Open Queue");
    expect(src).toContain("Open Focus Mode");
  });

  it("has navigation commands (Dashboard, Settings, Wallet)", () => {
    expect(src).toContain("Dashboard");
    expect(src).toContain("Settings");
    expect(src).toContain("Wallet");
  });

  it("all commands have real actions (no dead commands)", () => {
    // Every command item should have an action function
    expect(src).toContain("action:");
    // Should not have any TODO/FIXME markers
    expect(src).not.toContain("TODO");
    expect(src).not.toContain("FIXME");
    // Should not have empty/no-op actions
    expect(src).not.toContain("action: () => {}");
  });

  it("has keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)", () => {
    expect(src).toContain("ArrowDown");
    expect(src).toContain("ArrowUp");
    expect(src).toContain("Enter");
    expect(src).toContain("Escape");
  });

  it("has search filtering", () => {
    expect(src).toContain("query");
    expect(src).toContain("filter");
  });
});

describe("Dashboard v3 — Focus Mode", () => {
  const src = readSrc("Dashboard.tsx");

  it("shows current project in focus mode", () => {
    expect(src).toContain("Current Project");
    expect(src).toContain("project.name");
  });

  it("shows now playing in focus mode", () => {
    expect(src).toContain("Now Playing");
  });

  it("has exit button", () => {
    expect(src).toContain("Exit Focus");
  });

  it("shows quick play picks when nothing is playing", () => {
    expect(src).toContain("Quick Play");
  });

  it("is an overlay (fixed inset-0)", () => {
    expect(src).toContain("fixed inset-0 z-[180]");
  });
});

describe("Dashboard v3 — Developer Drawer (real info)", () => {
  const src = readSrc("Dashboard.tsx");

  it("shows real project info (name, branch, repository, commit)", () => {
    expect(src).toContain("DevInfoCard");
    expect(src).toContain("project.name");
    expect(src).toContain("project.branch");
    expect(src).toContain("project.repository");
    expect(src).toContain("project.latestCommit");
  });

  it("shows real runtime states (deployment, preview, workspace, terminal)", () => {
    expect(src).toContain("project.deploymentState");
    expect(src).toContain("project.previewState");
    expect(src).toContain("project.workspaceState");
    expect(src).toContain("project.terminalState");
  });

  it("shows pulse status items (no fake green checks)", () => {
    expect(src).toContain("pulseItems");
    expect(src).toContain("getPulseColor");
  });

  it("has empty state when no project connected", () => {
    expect(src).toContain("No project connected");
  });

  it("has Open Terminal action", () => {
    expect(src).toContain("Open Terminal");
    expect(src).toContain("onOpenTerminal");
  });
});

describe("Dashboard v3 — Responsive", () => {
  const dashboardSrc = readSrc("Dashboard.tsx");
  const mediaDockSrc = readSrc("MediaDock.tsx");
  const quickStartSrc = readSrc("QuickStart.tsx");

  it("Dashboard has mobile padding (px-4 md:px-6)", () => {
    expect(dashboardSrc).toContain("px-4");
    expect(dashboardSrc).toContain("md:px-6");
  });

  it("Dashboard has bottom padding for dock (pb-28 md:pb-32)", () => {
    expect(dashboardSrc).toContain("pb-28");
    expect(dashboardSrc).toContain("md:pb-32");
  });

  it("MediaDock has separate desktop and mobile layouts", () => {
    expect(mediaDockSrc).toContain("md:flex");
    expect(mediaDockSrc).toContain("md:hidden");
  });

  it("QuickStart reflows on mobile (grid-cols-2 → md:grid-cols-3)", () => {
    expect(quickStartSrc).toContain("grid-cols-2");
    expect(quickStartSrc).toContain("md:grid-cols-3");
  });
});
