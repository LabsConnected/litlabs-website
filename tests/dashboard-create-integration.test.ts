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
  // once — lives inside that one chat. (The creation-type entry hints
  // that originally lived there were later removed by the board-only
  // cleanup, Larry 2026-11-14 — see the chips test below.)
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

  it("carries no creation-type chips in the one chat — the board owns the content types", () => {
    // Board-only cleanup (Larry, 2026-11-14; recorded in
    // LiTEmptyState's own header): the creation-type chips (Website /
    // Image / Video / Music / Code / Design / Game), the prompt-starter
    // chips, and the resume list were removed at the source — the chat
    // lands straight in the conversation, and the content types live
    // on the board (Media covers Image / Video / Music; Code, Preview
    // and Canvas & Design cover the rest).
    for (const label of ["Website", "Image", "Video", "Music", "Code", "Design", "Game"]) {
      expect(emptyState).not.toContain(`label: "${label}"`);
    }
    expect(emptyState).not.toContain("entry-create-type-chips");
    expect(emptyState).not.toContain("onCreateType");
    // The entry still works without them: the empty state keeps its
    // functional surface — the launchpad state notice and its real
    // primary action (prepare/retry/configure).
    expect(emptyState).toContain("launchpadState");
    expect(emptyState).toContain("onPrimaryAction");
    // The pure destinations mapping for entry create types survives
    // (deep-link parity), even though the chips no longer call it.
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
