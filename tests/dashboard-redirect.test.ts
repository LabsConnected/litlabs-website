/**
 * /dashboard is retired as a page (Studio prime consolidation,
 * ART-20261110-029). The route survives only as a server-side redirect
 * into Studio so old bookmarks, the legacy /create chain, and emails
 * land on the one prime surface.
 *
 * Contract:
 *   /dashboard                  → /studio
 *   /dashboard?prompt=<text>    → /studio?prompt=<text>   (composer handoff)
 *   /dashboard?app=music        → /studio?tool=music      (legacy compat)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  // next/navigation redirect() throws to stop rendering; mirror that.
  throw new Error(`NEXT_REDIRECT:${url}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

async function callPage(params: Record<string, string>) {
  const mod = await import("@/app/(app)/dashboard/page");
  const Page = mod.default as unknown as (props: {
    searchParams: Promise<Record<string, string>>;
  }) => Promise<unknown>;
  await expect(Page({ searchParams: Promise.resolve(params) })).rejects.toThrow(
    /^NEXT_REDIRECT:/,
  );
}

describe("/dashboard → /studio redirect", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.resetModules();
  });

  it("redirects the bare route to Studio", async () => {
    await callPage({});
    expect(redirectMock).toHaveBeenCalledWith("/studio");
  });

  it("forwards a prompt handoff to Studio", async () => {
    await callPage({ prompt: "a site for my bakery" });
    expect(redirectMock).toHaveBeenCalledWith(
      "/studio?prompt=a+site+for+my+bakery",
    );
  });

  it("maps the legacy ?app=music bookmark to the Studio music tool", async () => {
    await callPage({ app: "music" });
    expect(redirectMock).toHaveBeenCalledWith("/studio?tool=music");
  });
});
