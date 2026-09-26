import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Dashboard owns the canonical create experience", () => {
  const dashboard = read("src/components/dashboard/v3/Dashboard.tsx");
  const composer = read("src/components/dashboard/v3/BuildConsole.tsx");
  const legacyCreate = read("src/app/(app)/create/page.tsx");
  const navigation = read("src/lib/navigation.ts");

  it("uses one universal composer on the dashboard", () => {
    expect(dashboard).toContain("BuildConsole");
    expect(dashboard).not.toContain("QuickStart");
    expect(composer).toContain("What do you want to make?");
    expect(composer).toContain('fetch("/api/litt/intent"');
    expect(composer).toContain('params.set("intent"');
    expect(composer.match(/onSubmit=\{submit\}/g)).toHaveLength(1);
  });

  it("honors deep-link prompts from the legacy /create redirect", () => {
    expect(dashboard).toContain('initialPrompt={searchParams.get("prompt")');
    expect(composer).toContain("initialPrompt");
  });

  it("exposes creation-type shortcuts without bypassing the router", () => {
    for (const label of ["Website", "Image", "Video", "Music", "Code", "Design", "Game"]) {
      expect(composer).toContain(`label: "${label}"`);
    }
    // Media/game chips deep-link into Studio's authoritative creator
    // surfaces; the typed prompt always goes through the intent router.
    for (const creator of ["image", "video", "music", "game"]) {
      expect(composer).toContain(`href: "/studio?creator=${creator}"`);
    }
    expect(composer).toContain('fetch("/api/litt/intent"');
  });

  it("redirects legacy /create links to Dashboard and preserves query params", () => {
    expect(legacyCreate).toContain("redirect(`/dashboard");
    expect(legacyCreate).toContain("Object.entries(params)");
    expect(legacyCreate).toContain("query.append(key, entry)");
  });

  it("removes Create from both desktop and mobile nav source", () => {
    expect(navigation).not.toContain('label: "Create", href: "/create"');
    expect(navigation).toContain('{ label: "Home", href: "/dashboard"');
  });
});
