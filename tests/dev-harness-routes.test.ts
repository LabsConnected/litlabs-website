/**
 * Developer harness routes stay usable in local dev and tests, and 404 in
 * production unless LITT_ENABLE_DEV_HARNESS=1. They must not be advertised
 * in the sitemap or left on the robots allowlist.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import RetroEmulatorTestLayout, {
  metadata as retroTestMetadata,
} from "@/app/(app)/games/retro/test/layout";
import VisualHarnessLayout, {
  metadata as visualTestMetadata,
} from "@/app/(app)/studio/visual-test/layout";
import RuntimeTestLayout, {
  metadata as runtimeTestMetadata,
} from "@/app/(app)/runtime-test/layout";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const HARNESS_LAYOUTS = [
  ["/games/retro/test", RetroEmulatorTestLayout, retroTestMetadata],
  ["/studio/visual-test", VisualHarnessLayout, visualTestMetadata],
  ["/runtime-test", RuntimeTestLayout, runtimeTestMetadata],
] as const;

function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev harness routes", () => {
  it.each(HARNESS_LAYOUTS)(
    "%s returns notFound in production",
    (_route, Layout) => {
      setNodeEnv("production");
      vi.stubEnv("LITT_ENABLE_DEV_HARNESS", "");
      expect(() => Layout({ children: "harness" })).toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each(HARNESS_LAYOUTS)(
    "%s renders in development",
    (_route, Layout) => {
      setNodeEnv("development");
      vi.stubEnv("LITT_ENABLE_DEV_HARNESS", "");
      expect(Layout({ children: "harness" })).toBe("harness");
    },
  );

  it.each(HARNESS_LAYOUTS)("%s renders in test", (_route, Layout) => {
    setNodeEnv("test");
    vi.stubEnv("LITT_ENABLE_DEV_HARNESS", "");
    expect(Layout({ children: "harness" })).toBe("harness");
  });

  it.each(HARNESS_LAYOUTS)(
    "%s renders in production when LITT_ENABLE_DEV_HARNESS=1",
    (_route, Layout) => {
      setNodeEnv("production");
      vi.stubEnv("LITT_ENABLE_DEV_HARNESS", "1");
      expect(Layout({ children: "harness" })).toBe("harness");
    },
  );

  it.each(HARNESS_LAYOUTS)("%s is noindex", (_route, _layout, metadata) => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("dev harness discovery", () => {
  const harnessPaths = ["/games/retro/test", "/studio/visual-test", "/runtime-test"];

  it("does not list harness routes in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of harnessPaths) {
      expect(urls.some((url) => url.includes(path))).toBe(false);
    }
  });

  it("disallows harness routes instead of leaving them on the robots allowlist", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = [rule?.disallow].flat().filter((value): value is string => typeof value === "string");
    expect(rule?.allow).toBe("/");
    expect(disallow).toEqual(
      expect.arrayContaining([
        "/games/retro/test",
        "/studio/visual-test",
        "/runtime-test",
      ]),
    );
  });
});
