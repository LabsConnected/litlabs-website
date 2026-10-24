import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { GET } from "./route";

function call(slug: string) {
  return GET(new NextRequest(`http://127.0.0.1:3000/agent-slug/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

describe("agent slug gate route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the framework 404 document for an unknown slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<title>404 — Page Not Found</title><p>Page Not Found</p>", {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const response = await call("not-a-real-agent");
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.text()).toContain("Page Not Found");
  });

  it("still returns the not-found UI when the framework document cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const response = await call("not-a-real-agent");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Page Not Found");
    expect(html).toContain('content="noindex, nofollow"');
  });

  it("returns the framework 404 document for an invalid slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const response = await call("constructor");
    expect(response.status).toBe(404);
  });

  it("redirects a known slug to Studio workflows", async () => {
    await expect(call("litt")).rejects.toThrow("NEXT_REDIRECT:/studio?tool=workflows");
  });
});
