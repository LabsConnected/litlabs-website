import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Design-compliance sweep guard (ART-20261111-081).
 *
 * Larry's standard: every page wears the LiTT Signature design (white
 * worked into green, lime accents). These source-level assertions keep
 * the surfaces converted by the sweep from regressing to hard-coded
 * dark palettes that ignore the applied theme. Kept separate from
 * tests/public-pages-theme.test.ts so it never collides with the held
 * #909/#912 guard extensions.
 *
 * Deliberate exceptions (functional dark, not page palette): modal
 * scrims and on-media overlays (bg-black/NN), white text on red/accent
 * buttons, emulator/DOS viewports, and the approved dark code hue
 * #0b120d used by code surfaces (same hue as Docs code panels).
 */
const read = (path: string) => readFileSync(resolve(path), "utf8");

const WHITE_ON_DARK = [
  "text-white/",
  "border-white/",
  "bg-white/",
  "placeholder-white",
];

describe("shared chrome wears Signature light", () => {
  it("LoadingBar (every route loading screen) has no dark palette values", () => {
    const src = read("src/components/ui/LoadingBar.tsx");
    for (const stale of ["#0f0f14", "#1a1a24", "#2a2a3a", "#e2e8f0", "#94a3b8"]) {
      expect(src).not.toContain(stale);
    }
    expect(src).toContain("#f6f9f1");
  });

  it("error / 404 family has no dark palette values", () => {
    for (const file of [
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/app/not-found.tsx",
      "src/components/route-error.tsx",
      "src/components/ErrorBoundary.tsx",
    ]) {
      const src = read(file);
      for (const stale of ["#0f0f14", "#1a1a24", "#2a2a3a"]) {
        expect(src, file).not.toContain(stale);
      }
    }
  });

  it("PageShell no longer fades every app page into near-black", () => {
    const src = read("src/components/PageShell.tsx");
    expect(src).not.toContain("#03050b");
    expect(src).not.toContain("#050812");
    expect(src).not.toContain("#080c17");
  });

  it("Dialog panel is light (scrim may stay dark)", () => {
    const src = read("src/components/ui/Dialog.tsx");
    expect(src).not.toContain("bg-[#10131b]");
  });

  it("auth pages have no dark palette values", () => {
    for (const file of ["src/app/sign-in/page.tsx", "src/app/(app)/sign-up/[[...sign-up]]/page.tsx"]) {
      const src = read(file);
      for (const stale of ["#0f0f14", "#1a1a24", "#2a2a3a"]) {
        expect(src, file).not.toContain(stale);
      }
    }
    expect(read("src/app/(auth)/loading.tsx")).not.toContain("bg-[#0a0a0f]");
    expect(read("src/app/oauth-consent/custom-consent-form.tsx")).not.toContain("bg-[#090d1b]");
  });

  it("OWNER plan menu uses light surfaces, not the near-black :root fallback", () => {
    const src = read("src/components/OwnerTestModeIndicator.tsx");
    expect(src).not.toContain('var(--studio-bg, #1a1a1a)');
    expect(src).not.toContain("rgba(168,85,247,0.15)");
    expect(src).toContain('var(--studio-surface, #ffffff)');
  });
});

describe("settings family wears Signature light", () => {
  const files = [
    "src/app/(app)/settings/page.tsx",
    "src/components/settings/SettingsPrimitives.tsx",
    "src/components/settings/WallpaperSection.tsx",
    "src/components/settings/LivePreviewPanel.tsx",
    "src/components/settings/IntegrationCard.tsx",
    "src/app/(app)/settings/connections/diagnostics/page.tsx",
  ];
  it("no white-on-dark utilities remain as chrome", () => {
    for (const file of files) {
      const src = read(file);
      for (const stale of WHITE_ON_DARK) {
        expect(src, `${file} :: ${stale}`).not.toContain(stale);
      }
    }
  });
  it("settings page dark islands are gone", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    expect(src).not.toContain("bg-[#090b12]");
    expect(src).not.toContain("bg-black/40");
  });
});

describe("studio surfaces wear Signature light", () => {
  it("shell rails/bars have no purple-black or white-on-dark chrome", () => {
    for (const file of [
      "src/components/studio/shell/LeftRail.tsx",
      "src/components/studio/shell/TopBar.tsx",
      "src/components/studio/shell/BottomDock.tsx",
      "src/components/studio/inspector/RightPanel.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toContain("#0d0a12");
      for (const stale of WHITE_ON_DARK) {
        expect(src, `${file} :: ${stale}`).not.toContain(stale);
      }
    }
    expect(read("src/components/studio/shell/StudioShell.tsx")).not.toContain("bg-[#07050a]");
  });

  it("MissionCards uses the theme card variable, not a hard-coded dark surface", () => {
    const src = read("src/app/(app)/studio/components/MissionCards.tsx");
    expect(src).not.toContain("rgba(16,12,26,0.92)");
    expect(src).toContain('CARD_SURFACE = "var(--studio-card)"');
  });

  it("PipelineTool has no fuchsia/purple dark theme left", () => {
    const src = read("src/app/(app)/studio/tools/PipelineTool.tsx");
    for (const stale of ["fuchsia", "#130720", "#050108", "#0a0310", "text-slate-"]) {
      expect(src).not.toContain(stale);
    }
  });

  it("canvas chrome and Builder tool have no white-on-dark utilities", () => {
    for (const file of [
      "src/app/(app)/studio/components/canvas/ActionPanel.tsx",
      "src/app/(app)/studio/components/canvas/CanvasPanel.tsx",
      "src/app/(app)/studio/components/canvas/BlockRenderer.tsx",
      "src/app/(app)/studio/components/canvas/RevisionHistory.tsx",
      "src/app/(app)/studio/tools/BuilderTool.tsx",
    ]) {
      const src = read(file);
      for (const stale of WHITE_ON_DARK) {
        expect(src, `${file} :: ${stale}`).not.toContain(stale);
      }
    }
  });

  it("voice overlay root is light; code workspace uses the approved code hue", () => {
    expect(read("src/app/(app)/studio/components/LiveVoiceOverlay.tsx")).not.toContain("bg-[#05050b]");
    const code = read("src/app/(app)/studio/components/code/CodeWorkspace.tsx");
    expect(code).not.toContain("#0a0b10");
    expect(code).toContain("#0b120d");
  });
});

describe("games + agents wear Signature light", () => {
  it("games pages have no dark page roots or white-on-dark chrome", () => {
    for (const file of [
      "src/app/(app)/games/page.tsx",
      "src/app/(app)/games/retro/page.tsx",
      "src/app/(app)/games/cloud/page.tsx",
      "src/components/games/GameCloudHome.tsx",
      "src/components/games/RetroControlsModal.tsx",
      "src/components/games/RetroArcadeEmbedded.tsx",
    ]) {
      const src = read(file);
      for (const stale of ["bg-[#070812]", "bg-[#140F1F]", "bg-[#07070b]", ...WHITE_ON_DARK]) {
        expect(src, `${file} :: ${stale}`).not.toContain(stale);
      }
    }
  });

  it("retro play page chrome is light while the game viewport stays black", () => {
    const src = read("src/app/(app)/games/retro/play/[gameId]/page.tsx");
    expect(src).not.toContain("bg-[#050507]");
    expect(src).toContain("bg-[#edf3e4]");
    expect(src).toContain("bg-black shadow-"); // emulator frame: functional dark, kept
  });

  it("agents page has no dark panels or dark rgba surfaces", () => {
    const src = read("src/app/(app)/agents/AgentsPageClient.tsx");
    for (const stale of ["bg-[#070a12]", "bg-[#050812]", "rgba(3,5,11", "rgba(169,112,255", ...WHITE_ON_DARK]) {
      expect(src).not.toContain(stale);
    }
  });
});
