import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Studio prime landing owns the canonical create experience", () => {
  const landing = read("src/app/(app)/studio/components/StudioPrimeLanding.tsx");
  const composer = read("src/components/dashboard/v3/BuildConsole.tsx");
  const legacyCreate = read("src/app/(app)/create/page.tsx");
  const dashboardRoute = read("src/app/(app)/dashboard/page.tsx");
  const navigation = read("src/lib/navigation.ts");

  it("uses one universal composer on the Studio prime landing", () => {
    // The launcher was ported, not rebuilt: the landing mounts the same
    // BuildConsole component the retired dashboard carried, next to the
    // same RecentWork recent-projects list.
    expect(landing).toContain("BuildConsole");
    expect(landing).toContain("RecentWork");
    expect(landing).not.toContain("QuickStart");
    expect(composer).toContain("What do you want to make?");
    expect(composer).toContain('fetch("/api/litt/intent"');
    expect(composer).toContain('params.set("intent"');
    expect(composer.match(/onSubmit=\{submit\}/g)).toHaveLength(1);
  });

  it("honors deep-link prompts from the legacy /create redirect", () => {
    expect(landing).toContain('initialPrompt={searchParams.get("prompt")');
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

  it("redirects legacy /create links to Studio and preserves query params", () => {
    expect(legacyCreate).toContain("redirect(`/studio");
    expect(legacyCreate).toContain("Object.entries(params)");
    expect(legacyCreate).toContain("query.append(key, entry)");
  });

  it("retires /dashboard as a page — the route only redirects to Studio", () => {
    expect(dashboardRoute).toContain('redirect(suffix ? `/studio?${suffix}` : "/studio")');
    expect(dashboardRoute).not.toContain("DashboardView");
  });

  it("removes Create from both desktop and mobile nav source", () => {
    expect(navigation).not.toContain('label: "Create", href: "/create"');
    expect(navigation).toContain('{ label: "Studio", href: "/studio"');
    expect(navigation).not.toContain('href: "/dashboard"');
  });
});
