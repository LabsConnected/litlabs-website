import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { absoluteUrl } from "@/lib/seo";
import { isPublicTestPageBlocked } from "@/lib/public-test-pages";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/app/(app)/studio/visual-test/VisualHarnessClient", () => ({
  default: function VisualHarnessClient() {
    return "visual-harness";
  },
}));

import RetroTestLayout, {
  generateMetadata as retroMetadata,
} from "@/app/(app)/games/retro/test/layout";
import VisualTestLayout, {
  generateMetadata as visualMetadata,
} from "@/app/(app)/studio/visual-test/layout";
import RuntimeTestLayout, {
  generateMetadata as runtimeMetadata,
} from "@/app/(app)/runtime-test/layout";
import VisualHarnessPage from "@/app/(app)/studio/visual-test/page";

const HIDDEN_PATHS = ["/games/retro/test", "/studio/visual-test", "/runtime-test"];

type LayoutFn = (props: { children: ReactNode }) => ReactNode;
type MetadataFn = () => { robots?: { index?: boolean; follow?: boolean } };

const gatedLayouts: Array<[string, LayoutFn, MetadataFn]> = [
  ["retro test", RetroTestLayout, retroMetadata],
  ["visual test", VisualTestLayout, visualMetadata],
  ["runtime test", RuntimeTestLayout, runtimeMetadata],
];

describe("public test page gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks production unless ENABLE_PUBLIC_TEST_PAGES=1, and allows dev/test", () => {
    expect(isPublicTestPageBlocked({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(
      isPublicTestPageBlocked({
        NODE_ENV: "production",
        ENABLE_PUBLIC_TEST_PAGES: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isPublicTestPageBlocked({
        NODE_ENV: "production",
        ENABLE_PUBLIC_TEST_PAGES: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(isPublicTestPageBlocked({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPublicTestPageBlocked({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it.each(gatedLayouts)(
    "%s calls notFound in production",
    (_name, Layout, metadata) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ENABLE_PUBLIC_TEST_PAGES", "");
      expect(() => Layout({ children: createElement("div", null, "secret") })).toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(() => metadata()).toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each(gatedLayouts)("%s renders in test and development", (_name, Layout) => {
    for (const nodeEnv of ["test", "development"] as const) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("ENABLE_PUBLIC_TEST_PAGES", "");
      const html = renderToString(
        Layout({ children: createElement("div", null, "harness-visible") }),
      );
      expect(html).toContain("harness-visible");
    }
  });

  it.each(gatedLayouts)(
    "%s renders in production when ENABLE_PUBLIC_TEST_PAGES=1 and stays noindex",
    (_name, Layout, metadata) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ENABLE_PUBLIC_TEST_PAGES", "1");
      const html = renderToString(
        Layout({ children: createElement("div", null, "harness-visible") }),
      );
      expect(html).toContain("harness-visible");
      expect(metadata().robots).toEqual({ index: false, follow: false });
    },
  );

  it("visual test page calls notFound in production and renders the harness in test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_PUBLIC_TEST_PAGES", "");
    expect(() => VisualHarnessPage()).toThrow("NEXT_NOT_FOUND");

    vi.stubEnv("NODE_ENV", "test");
    const html = renderToString(VisualHarnessPage());
    expect(html).toContain("visual-harness");
  });

  it("keeps harness routes out of the sitemap and the robots allowlist", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of HIDDEN_PATHS) {
      expect(urls).not.toContain(absoluteUrl(path));
    }

    const rules = Array.isArray(robots().rules) ? robots().rules : [robots().rules];
    const root = rules.find((rule) => rule.allow === "/");
    const disallow = Array.isArray(root?.disallow)
      ? root.disallow
      : root?.disallow
        ? [root.disallow]
        : [];
    expect(disallow).toEqual(
      expect.arrayContaining(["/games/retro/test", "/studio/visual-test", "/runtime-test/"]),
    );
    expect(root?.allow).toBe("/");
  });
});
