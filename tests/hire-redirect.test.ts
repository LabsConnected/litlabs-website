/**
 * /hire dead-redirect regression.
 *
 * /hire is permanently retired from the v1 launch surface. The redirect to
 * /studio is authoritative and unconditional — it must not depend on the
 * hireServices feature flag (or any other config) to fire, and the
 * signed-in sidebar must not link to it (see tests/app-shell-navigation.test.ts).
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
  it("HirePage always redirects to /studio", async () => {
    const { default: HirePage } = await import("@/app/(app)/hire/page");
    expect(() => HirePage()).toThrow("NEXT_REDIRECT:/studio");
  });

  it("does not import isFeatureEnabled — the redirect is unconditional, not flag-gated", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(process.cwd(), "src/app/(app)/hire/page.tsx"),
      "utf-8",
    );
    expect(source).not.toContain("isFeatureEnabled");
    expect(source).not.toContain("feature-flags");
  });
});
