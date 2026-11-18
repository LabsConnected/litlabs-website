/**
 * /memories route-level redirect regression — PR #934, issue #627.
 *
 * The /memories page is a pure server-side redirect to /studio?tool=memory.
 * Before #934 that URL was a silent dead end: mapLegacyToolToDestination
 * had no "memory" case, so the Studio shell fell through to its default
 * (destination studio, legacyTool "chat", mode "preview") instead of the
 * intended Studio/Work surface. The unit regression for the mapping itself
 * lives in src/app/(app)/studio/lib/studio-destinations.test.ts; this file
 * proves the ROUTE end-to-end: the URL the /memories page actually
 * produces, fed through the real mapping, lands on Studio/Work — not on
 * the default fallthrough.
 *
 * Follows the route-level redirect pattern of tests/dashboard-redirect.test.ts
 * and tests/hire-redirect.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapLegacyToolToDestination } from "@/app/(app)/studio/lib/studio-destinations";

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  // next/navigation redirect() throws to stop rendering; mirror that.
  throw new Error(`NEXT_REDIRECT:${url}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

async function callMemoriesPage(): Promise<string> {
  const { default: MemoriesPage } = await import("@/app/(app)/memories/page");
  expect(() => MemoriesPage()).toThrow(/^NEXT_REDIRECT:/);
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return redirectMock.mock.calls[0][0] as string;
}

describe("/memories → /studio?tool=memory redirect (route level)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.resetModules();
  });

  it("redirects /memories to /studio?tool=memory", async () => {
    const target = await callMemoriesPage();
    expect(target).toBe("/studio?tool=memory");
    expect(redirectMock).toHaveBeenCalledWith("/studio?tool=memory");
  });

  it("the tool the route hands off maps to Studio/Work, not the default fallthrough", async () => {
    const target = await callMemoriesPage();
    const tool = new URL(target, "https://litlabs.net").searchParams.get("tool");
    expect(tool).toBe("memory");

    const result = mapLegacyToolToDestination(tool as string);
    expect(result.destination).toBe("studio");
    expect(result.mode).toBe("work");
    expect(result.legacyTool).toBe("memory");

    // Contrast with the pre-#934 behavior: an unmapped tool silently falls
    // through to the default (chat/preview). The memory mapping must differ.
    const fallthrough = mapLegacyToolToDestination("definitely-not-a-tool");
    expect(fallthrough.mode).toBe("preview");
    expect(fallthrough.legacyTool).toBe("chat");
    expect(result.mode).not.toBe(fallthrough.mode);
    expect(result.legacyTool).not.toBe(fallthrough.legacyTool);
  });
});
