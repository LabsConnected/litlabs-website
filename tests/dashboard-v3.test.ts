/**
 * Dashboard v3 — composition and integration tests.
 *
 * The dashboard is a minimal launchpad, not an operations console:
 *   1. One universal "What do you want to make?" composer
 *   2. Creation type shortcuts
 *   3. Recent projects
 *   4. Only actionable warnings/status
 *
 * Runtime telemetry (Live Project Status, Agent Activity, Recent Media,
 * terminal/build/deploy state, branch/repository info) lives in Studio at
 * /studio/mission-control. The Developer drawer stays collapsed by default
 * and opens only through the explicit Developer entry button.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const V3_DIR = path.resolve(__dirname, "../src/components/dashboard/v3");

function readSrc(filename: string): string {
  return fs.readFileSync(path.join(V3_DIR, filename), "utf-8");
}

describe("Dashboard v3 — launchpad composition", () => {
  const dashboardSrc = readSrc("Dashboard.tsx");

  it("does not render the retired ContinueWorking section", () => {
    expect(dashboardSrc).not.toContain("ContinueWorking");
  });

  it("renders the one universal composer (BuildConsole)", () => {
    expect(dashboardSrc).toContain("BuildConsole");
  });

  it("removed the duplicate QuickStart composer entirely", () => {
    expect(dashboardSrc).not.toContain("QuickStart");
    expect(fs.existsSync(path.join(V3_DIR, "QuickStart.tsx"))).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(__dirname, "../src/components/create/CreateExperience.tsx"),
      ),
    ).toBe(false);
  });

  it("renders RecentWork (recent projects)", () => {
    expect(dashboardSrc).toContain("RecentWork");
  });

  it("renders ActionNeededStrip (actionable warnings only)", () => {
    expect(dashboardSrc).toContain("ActionNeededStrip");
  });

  it("does NOT render runtime telemetry on the dashboard", () => {
    for (const name of [
      "LiveProjectStatus",
      "AgentActivity",
      "RecentMedia",
      "ProjectPulseBar",
    ]) {
      expect(dashboardSrc).not.toContain(name);
    }
  });

  it("renders MediaDock (persistent footer)", () => {
    expect(dashboardSrc).toContain("MediaDock");
  });

  it("does NOT render a duplicate nav header (global nav lives in AppShell)", () => {
    expect(dashboardSrc).not.toContain("DashboardHeader");
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

  it("has an explicit Developer entry button (collapsed by default)", () => {
    expect(dashboardSrc).toContain('data-testid="developer-entry"');
    // The drawer is closed until explicitly opened.
    expect(dashboardSrc).toContain("useState(false)");
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

  it("uses a single calm centered column (no ops-console grid)", () => {
    expect(dashboardSrc).toContain("max-w-4xl");
    expect(dashboardSrc).not.toContain("lg:grid-cols-12");
    expect(dashboardSrc).not.toContain("lg:col-span-7");
  });

  it("passes deep-link prompts into the composer", () => {
    expect(dashboardSrc).toContain('searchParams.get("prompt")');
  });
});

describe("Dashboard v3 — ActionNeededStrip (actionable status only)", () => {
  const src = readSrc("ActionNeededStrip.tsx");

  it("renders nothing while loading", () => {
    expect(src).toContain("if (loading) return null");
  });

  it("renders nothing when nothing failed", () => {
    expect(src).toContain('state === "failed"');
    expect(src).toContain("if (failed.length === 0) return null");
  });

  it("never shows idle/unknown telemetry", () => {
    expect(src).not.toContain('"unknown"');
    expect(src).not.toContain('"idle"');
  });

  it("links failures to Studio with plain-English copy", () => {
    expect(src).toContain('href="/studio"');
    expect(src).toContain("Something needs attention");
  });
});

describe("Dashboard v3 — mission control lives in Studio", () => {
  const pageSrc = fs.readFileSync(
    path.resolve(
      __dirname,
      "../src/app/(app)/studio/mission-control/page.tsx",
    ),
    "utf-8",
  );

  it("renders the moved telemetry components", () => {
    for (const name of ["LiveProjectStatus", "AgentActivity", "RecentMedia"]) {
      expect(pageSrc).toContain(name);
    }
  });

  it("feeds them from the real dashboard data hooks", () => {
    expect(pageSrc).toContain("useMissionControl");
    expect(pageSrc).toContain("useDashboardMedia");
  });

  it("links back to Studio", () => {
    expect(pageSrc).toContain('href="/studio"');
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

describe("Dashboard v3 — universal composer", () => {
  const src = readSrc("BuildConsole.tsx");

  it("asks 'What do you want to make?'", () => {
    expect(src).toContain("What do you want to make?");
    expect(src).not.toContain("What do you want to build?");
  });

  it("has the canonical creation-type shortcuts", () => {
    for (const label of ["Website", "Image", "Video", "Music", "Code", "Design", "Game"]) {
      expect(src).toContain(`label: "${label}"`);
    }
  });

  it("routes prompts through the intent router (never a dead end)", () => {
    expect(src).toContain('fetch("/api/litt/intent"');
    expect(src).toContain('params.set("intent"');
    expect(src).toContain("/studio?tool=chat&prompt=");
  });

  it("accepts deep-link prompts (legacy /create redirect)", () => {
    expect(src).toContain("initialPrompt");
    expect(src).toContain('id="dashboard-guided-start"');
  });

  it("uses the LIME canonical accent", () => {
    expect(src).toContain("#a8ff2f");
    expect(src).not.toContain("#a78bfa");
  });

  it("is responsive and touch-friendly", () => {
    expect(src).toContain("flex-col");
    expect(src).toContain("sm:flex-row");
    expect(src).toContain("min-h-14");
    expect(src).toContain("min-h-11");
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

  it("hides the dock when nothing is playing (no persistent empty bar)", () => {
    expect(src).toContain('source === "none"');
    expect(src).toContain("return null");
    expect(src).not.toContain("Nothing playing — Choose media");
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

describe("Dashboard v3 — Developer Drawer (real info, collapsed by default)", () => {
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

  it("has empty state when no project connected", () => {
    expect(src).toContain("No project connected");
  });

  it("has Open Terminal action", () => {
    expect(src).toContain("Open Terminal");
    expect(src).toContain("onOpenTerminal");
  });

  it("links to mission control in Studio", () => {
    expect(src).toContain("/studio/mission-control");
  });

  it("opens only through the explicit Developer entry", () => {
    expect(src).toContain('data-testid="developer-entry"');
    expect(src).toContain("setDevDrawerOpen(true)");
  });
});

describe("Dashboard v3 — Responsive", () => {
  const dashboardSrc = readSrc("Dashboard.tsx");
  const mediaDockSrc = readSrc("MediaDock.tsx");
  const composerSrc = readSrc("BuildConsole.tsx");

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

  it("Composer reflows on mobile and preserves touch targets", () => {
    expect(composerSrc).toContain("flex-col");
    expect(composerSrc).toContain("sm:flex-row");
    expect(composerSrc).toContain("min-h-14");
    expect(composerSrc).toContain("min-h-11");
  });
});
