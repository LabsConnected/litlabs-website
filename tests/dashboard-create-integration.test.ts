import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Studio one-chat entry owns the canonical create experience", () => {
  // One-chat entry (Larry's directive, 2026-11-11; ART-20261111-031)
  // supersedes the prime-landing premise of the original gate: the
  // "What do you want to make?" hub page is retired and /studio opens
  // straight into the main chat. The create experience — describe
  // once, creation-type entry hints — lives inside that one chat.
  const page = read("src/app/(app)/studio/page.tsx");
  const commandStudio = read("src/app/(app)/studio/components/CommandStudio.tsx");
  const emptyState = read("src/app/(app)/studio/components/LiTEmptyState.tsx");
  const destinations = read("src/app/(app)/studio/lib/studio-destinations.ts");
  const legacyCreate = read("src/app/(app)/create/page.tsx");
  const dashboardRoute = read("src/app/(app)/dashboard/page.tsx");
  const navigation = read("src/lib/navigation.ts");

  it("renders the one chat at the /studio entry — the hub landing is retired", () => {
    expect(page).not.toContain("StudioPrimeLanding");
    expect(
      fs.existsSync(
        path.join(root, "src/app/(app)/studio/components/StudioPrimeLanding.tsx"),
      ),
    ).toBe(false);
    expect(page).toContain("CommandStudio");
  });

  it("carries a describe deep link into the one chat's composer", () => {
    // ?prompt= is consumed by CommandStudio itself (the first-run
    // handoff channel): the text lands in the chat's own composer —
    // typed once at entry, never re-asked, never a second prompt.
    expect(commandStudio).toContain('takeFirstRunPrompt(searchParams.get("prompt"))');
  });

  it("exposes the seven creation types as entry hints inside the one chat", () => {
    for (const label of ["Website", "Image", "Video", "Music", "Code", "Design", "Game"]) {
      expect(emptyState).toContain(`label: "${label}"`);
    }
    expect(emptyState).toContain("entry-create-type-chips");
    expect(emptyState).toContain("onCreateType");
    // The in-place routing for those hints is resolved by the pure
    // destinations mapping (hub-href parity, executed in place).
    expect(destinations).toContain("resolveEntryCreateType");
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
