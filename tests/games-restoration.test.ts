import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function fileExists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

function fileContains(rel: string, needle: string): boolean {
  if (!fileExists(rel)) return false;
  const content = readFileSync(join(ROOT, rel), "utf8");
  return content.includes(needle);
}

describe("Games Restoration — Navigation & Feature Flags", () => {
  describe("Feature flag is enabled", () => {
    it("retroGameRuntime.enabled is true", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[^}]*enabled:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("true");
    });

    it("retroGameRuntime.hideFromNav is false", () => {
      const content = readFileSync(join(ROOT, "src/config/feature-flags.ts"), "utf8");
      const match = content.match(/retroGameRuntime:\s*\{[^}]*hideFromNav:\s*(true|false)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("false");
    });
  });

  describe("Desktop navigation includes Games", () => {
    it("Navbar has an uncommented Games entry", () => {
      const content = readFileSync(join(ROOT, "src/components/Navbar.tsx"), "utf8");
      // The entry should NOT be commented out
      expect(content).not.toMatch(/\/\/\s*\{\s*href:\s*"\/games"/);
      // It should be an active entry
      expect(content).toMatch(/\{\s*href:\s*"\/games",\s*label:\s*"Games",\s*icon:\s*Gamepad2\s*\}/);
    });
  });

  describe("Mobile navigation includes Games", () => {
    it("Navbar mobile drawer has a Games group", () => {
      const content = readFileSync(join(ROOT, "src/components/Navbar.tsx"), "utf8");
      // The mobile Games group should NOT be commented out
      expect(content).not.toMatch(/\/\/\s*\{\s*label:\s*"Games"/);
      // It should be an active entry
      expect(content).toMatch(/\{\s*label:\s*"Games",\s*links:\s*\[\s*\{\s*href:\s*"\/games"/);
    });
  });

  describe("Mission Control dashboard quick launch", () => {
    it("MissionControlDashboard has the four premium quick launch tiles", () => {
      const content = readFileSync(
        join(ROOT, "src/components/dashboard/v2/MissionControlDashboard.tsx"),
        "utf8",
      );
      expect(content).toContain('label="BUILD"');
      expect(content).toContain('label="CREATE"');
      expect(content).toContain('label="AGENTS"');
      expect(content).toContain('label="DEPLOY"');
    });
  });
});

describe("Games Restoration — Route Files Exist", () => {
  const routes = [
    "src/app/games/page.tsx",
    "src/app/games/layout.tsx",
    "src/app/games/retro/page.tsx",
    "src/app/games/retro/layout.tsx",
    "src/app/games/retro/play/[gameId]/page.tsx",
    "src/app/games/retro/play/[gameId]/layout.tsx",
    "src/app/games/dos/page.tsx",
    "src/app/games/dos/layout.tsx",
    "src/app/games/cloud/page.tsx",
    "src/app/games/cloud/layout.tsx",
  ];

  for (const route of routes) {
    it(`${route} exists`, () => {
      expect(fileExists(route)).toBe(true);
    });
  }

  it("game library exists", () => {
    expect(fileExists("src/lib/games.ts")).toBe(true);
  });

  it("retro arcade library exists", () => {
    expect(fileExists("src/lib/retro-arcade.ts")).toBe(true);
  });

  it("game components directory has content", () => {
    expect(fileExists("src/components/games/GameCard.tsx")).toBe(true);
    expect(fileExists("src/components/games/GameCloudHome.tsx")).toBe(true);
    expect(fileExists("src/components/games/RetroArcadeEmbedded.tsx")).toBe(true);
  });
});

describe("Games Restoration — Old App Launcher Still Has Games", () => {
  it("dashboard-data.ts APPS array includes Games", () => {
    const content = readFileSync(join(ROOT, "src/components/dashboard/dashboard-data.ts"), "utf8");
    expect(content).toContain('id: "games"');
    expect(content).toContain('href: "/games"');
  });
});

describe("Games Restoration — Icon Support", () => {
  it("Mission Control Icon component supports 'gamepad'", () => {
    const content = readFileSync(
      join(ROOT, "src/components/dashboard/v2/dashboard-v2-utils.tsx"),
      "utf8",
    );
    expect(content).toContain("gamepad:");
  });
});
