/**
 * /hire dead-redirect regression.
 *
 * /hire is retired from the v1 launch surface via the hireServices feature
 * flag (currently disabled). The page must deterministically redirect
 * visitors to /studio while the flag is off, rather than rendering the
 * retired offer catalog or 404ing, and the signed-in sidebar must not
 * link to it (see tests/app-shell-navigation.test.ts). The redirect is
 * gated on the flag — not unconditional — so re-enabling hireServices
 * restores the route without a second code change.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw err;
  }),
}));

describe("/hire redirect", () => {
  it("hireServices feature flag is disabled for v1 launch", async () => {
    const { isFeatureEnabled } = await import("@/config/feature-flags");
    expect(isFeatureEnabled("hireServices")).toBe(false);
  });

  it("HirePage redirects to /studio while hireServices is disabled", async () => {
    const { default: HirePage } = await import("@/app/(app)/hire/page");
    await expect(HirePage()).rejects.toThrow("NEXT_REDIRECT:/studio");
  });
});
