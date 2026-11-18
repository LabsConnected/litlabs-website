import { describe, it, expect } from "vitest";
import {
  detectToolIntent,
  detectWebFetchIntent,
  extractFetchUrl,
} from "./tool-executor";

/**
 * Intent-detection tests for the web_fetch tool added alongside the
 * keyless web-search fallback. The Studio chat realtime path only runs
 * a tool when an intent matches, and it previously had NO way to fetch
 * a URL the user named — the model was left to (honestly) say it could
 * not browse.
 */

describe("extractFetchUrl", () => {
  it("extracts a URL and trims trailing sentence punctuation", () => {
    expect(extractFetchUrl("read https://example.com/docs, please")).toBe(
      "https://example.com/docs",
    );
  });

  it("returns null when there is no URL", () => {
    expect(extractFetchUrl("what is the latest news")).toBeNull();
  });
});

describe("detectWebFetchIntent", () => {
  it("fires for an explicit read/fetch request naming a URL", () => {
    expect(detectWebFetchIntent("read https://example.com/page and tell me what it says")).toBe(true);
    expect(detectWebFetchIntent("fetch https://example.com/api/status")).toBe(true);
    expect(detectWebFetchIntent("summarize https://example.com/blog/post")).toBe(true);
  });

  it("fires for a bare URL", () => {
    expect(detectWebFetchIntent("https://example.com/page")).toBe(true);
  });

  it("does not fire when a URL is merely mentioned without a fetch verb", () => {
    expect(detectWebFetchIntent("my site https://example.com has a bug in the header component")).toBe(false);
  });

  it("does not fire without a URL", () => {
    expect(detectWebFetchIntent("read me the latest headlines")).toBe(false);
  });
});

describe("detectToolIntent routing", () => {
  it("routes URL fetch requests to web_fetch before web_search", () => {
    expect(detectToolIntent("open https://example.com and check the latest version"))?.toEqual({
      tool: "web_fetch",
    });
  });

  it("still routes keyword searches to web_search", () => {
    expect(detectToolIntent("search for the latest news about LiTT"))?.toEqual({
      tool: "web_search",
    });
  });
});
