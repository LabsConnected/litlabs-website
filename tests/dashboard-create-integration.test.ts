import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Dashboard owns the canonical create experience", () => {
  const dashboard = read("src/components/dashboard/v3/Dashboard.tsx");
  const quickStart = read("src/components/dashboard/v3/QuickStart.tsx");
  const createExperience = read("src/components/create/CreateExperience.tsx");
  const legacyCreate = read("src/app/(app)/create/page.tsx");
  const navigation = read("src/lib/navigation.ts");

  it("uses one shared prompt and creation flow", () => {
    expect(quickStart).toContain("CreateExperience");
    expect(dashboard).toContain('initialPrompt={searchParams.get("prompt")');
    expect(createExperience).toContain('fetch("/api/litt/intent"');
    expect(createExperience).toContain("params.set(\"intent\"");
    expect(createExperience.match(/onSubmit=\{submit\}/g)).toHaveLength(1);
  });

  it("exposes all seven quick-create intents with real Studio routes", () => {
    for (const label of ["Website", "Image", "Video", "Music & Audio", "Code", "Design", "Game"]) {
      expect(createExperience).toContain(`label: "${label}"`);
    }
    expect(createExperience.match(new RegExp('href: "/studio\\?', "g"))?.length).toBe(7);
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
