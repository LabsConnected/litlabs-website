/**
 * Layout/theme wave gate (Larry's 2026-11-10 layout + theme rulings).
 *
 * Static source assertions, same credential-free pattern as the J2b hue
 * gate: these surfaces shipped hard-coded dark presentations that
 * ignored the theme system entirely (a near-black Studio landing, a
 * dark Missions canvas under a light theme, a detached dark companion
 * pop-out, a left-welded chat default). The behaviors behind several
 * pins are covered by runtime tests elsewhere (theme-default-signature,
 * CommandStudio.shell); this gate makes the hard-coding itself
 * un-regressable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (rel: string): string =>
  readFileSync(join(__dirname, rel), "utf8");

const LANDING = "../../../app/(app)/studio/components/StudioPrimeLanding.tsx";
const BUILD_CONSOLE = "../../../components/dashboard/v3/BuildConsole.tsx";
const RECENT_WORK = "../../../components/dashboard/v3/RecentWork.tsx";
const MISSION_FORGE = "../../../app/(app)/studio/tools/MissionForge.tsx";
const MISSION_CONTROL_PAGE = "../../../app/(app)/studio/mission-control/page.tsx";
const LIVE_STATUS = "../../../components/dashboard/v3/LiveProjectStatus.tsx";
const AGENT_ACTIVITY = "../../../components/dashboard/v3/AgentActivity.tsx";
const RECENT_MEDIA = "../../../components/dashboard/v3/RecentMedia.tsx";
const THEME_CONTEXT = "../../../context/ThemeContext.tsx";
const WALLPAPERS = "../../../lib/wallpapers.ts";
const ANIMATED_BG = "../../../components/AnimatedBackground.tsx";
const COMPANION = "../../../components/companion/GlobalCompanion.tsx";
const COMMAND_STUDIO = "../../../app/(app)/studio/components/CommandStudio.tsx";
const STUDIO_SHELL = "../../../app/(app)/studio/components/shell/StudioShell.tsx";

describe("layout/theme gate — landing", () => {
  it("StudioPrimeLanding consumes theme tokens and is widened", () => {
    const s = src(LANDING);
    expect(s).not.toContain("#0b120d");
    expect(s).toContain("tokens.background");
    expect(s).not.toContain("max-w-4xl");
    expect(s).toContain("max-w-6xl");
  });

  it("BuildConsole is theme-token driven (no hard-coded dark card)", () => {
    const s = src(BUILD_CONSOLE);
    expect(s).not.toContain("rgba(38,52,18");
    expect(s).not.toContain("bg-black/40");
    expect(s).toContain("useTheme");
  });

  it("RecentWork is theme-token driven", () => {
    const s = src(RECENT_WORK);
    expect(s).not.toContain("rgba(18,18,21");
    expect(s).toContain("useTheme");
  });
});

describe("layout/theme gate — Missions surfaces", () => {
  it("MissionForge canvas/root are theme-gated, not hard-coded dark", () => {
    const s = src(MISSION_FORGE);
    expect(s).not.toContain("bg-[#03050a]");
    expect(s).not.toContain("border-[#03050a]");
    expect(s).toContain("isLight");
    // The afterglow photo stage survives ONLY as the dark-theme branch.
    expect(s).toContain('backgroundSize: "26px 26px"');
  });

  it("mission-control page + cards are theme-token driven", () => {
    expect(src(MISSION_CONTROL_PAGE)).not.toContain("#0a0a0a");
    expect(src(MISSION_CONTROL_PAGE)).toContain("tokens.background");
    expect(src(LIVE_STATUS)).not.toContain("rgba(18,18,21");
    expect(src(AGENT_ACTIVITY)).not.toContain("rgba(18,18,21");
    expect(src(RECENT_MEDIA)).not.toContain("rgba(18,18,21");
  });
});

describe("layout/theme gate — wallpaper coupling", () => {
  it("the LiTT Signature pack declares its wallpaper + zero veil", () => {
    const s = src(THEME_CONTEXT);
    const packStart = s.indexOf('id: "litt-signature"');
    expect(packStart).toBeGreaterThan(-1);
    const pack = s.slice(packStart, packStart + 900);
    expect(pack).toContain('wallpaperId: "minimal"');
    expect(pack).toContain("overlayOpacity: 0");
  });

  it("Pure Minimal cleans the veil and effect when picked directly", () => {
    const s = src(WALLPAPERS);
    const start = s.indexOf("id: 'minimal'");
    expect(start).toBeGreaterThan(-1);
    const entry = s.slice(start, start + 700);
    expect(entry).toContain("defaultEffect: 'none'");
    expect(entry).toContain("defaultOverlay: 0");
  });

  it("AnimatedBackground lets the theme win over stale profile state", () => {
    const s = src(ANIMATED_BG);
    expect(s).toContain('mode === "minimal" ? "none"');
    expect(s).toContain("showDarkVeil");
    expect(s).toContain('theme.mode !== "light"');
  });
});

describe("layout/theme gate — chat presentation", () => {
  it("the companion panel is a docked theme surface, not a dark pop-out", () => {
    const s = src(COMPANION);
    expect(s).not.toContain("bg-[#0a0c13]/95");
    expect(s).not.toContain('bottom-24');
    expect(s).toContain('data-testid="global-companion-panel"');
    expect(s).toContain("inset-y-0");
    expect(s).toContain("useTheme");
  });

  it("Studio chat defaults to the integrated dock with an explicit-choice marker", () => {
    const s = src(COMMAND_STUDIO);
    expect(s).toContain("CHAT_DOCK_EXPLICIT_KEY");
    expect(s).not.toContain("overlay={!littCollapsed}");
  });

  it("StudioShell chrome uses the shell scope tokens", () => {
    const s = src(STUDIO_SHELL);
    expect(s).not.toContain("#0a0a0b");
    expect(s).not.toContain("border-white/10");
    expect(s).toContain("var(--studio-surface)");
  });
});
