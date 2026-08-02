import { describe, it, expect } from "vitest";
import { normalizeMediaUrl, isValidMediaUrl, filterValidMediaUrls } from "./media-url";

describe("normalizeMediaUrl", () => {
  it("rejects null", () => {
    expect(normalizeMediaUrl(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(normalizeMediaUrl(undefined)).toBeNull();
  });

  it('rejects the literal string "null"', () => {
    expect(normalizeMediaUrl("null")).toBeNull();
  });

  it('rejects the literal string "undefined"', () => {
    expect(normalizeMediaUrl("undefined")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(normalizeMediaUrl("")).toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(normalizeMediaUrl("   ")).toBeNull();
  });

  it("rejects file: URLs", () => {
    expect(normalizeMediaUrl("file:///C:/Users/music/track.mp3")).toBeNull();
    expect(normalizeMediaUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects non-string types", () => {
    expect(normalizeMediaUrl(42)).toBeNull();
    expect(normalizeMediaUrl(true)).toBeNull();
    expect(normalizeMediaUrl({})).toBeNull();
    expect(normalizeMediaUrl([])).toBeNull();
  });

  it("rejects http: URLs (only https allowed)", () => {
    expect(normalizeMediaUrl("http://example.com/track.mp3")).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(normalizeMediaUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(normalizeMediaUrl("not a url")).toBeNull();
    expect(normalizeMediaUrl("https://")).toBeNull();
  });

  it("accepts valid same-origin relative paths", () => {
    expect(normalizeMediaUrl("/api/tracks/123/audio")).toBe(
      "/api/tracks/123/audio",
    );
    expect(normalizeMediaUrl("/audio/track.mp3")).toBe("/audio/track.mp3");
  });

  it("accepts valid https URLs", () => {
    expect(normalizeMediaUrl("https://example.com/track.mp3")).toBe(
      "https://example.com/track.mp3",
    );
    expect(
      normalizeMediaUrl("https://www.youtube.com/embed/dX3k_QDnzHE"),
    ).toBe("https://www.youtube.com/embed/dX3k_QDnzHE");
  });

  it("accepts blob: URLs", () => {
    expect(
      normalizeMediaUrl("blob:https://litlabs.net/123e4567-e89b-12d3"),
    ).toBe("blob:https://litlabs.net/123e4567-e89b-12d3");
  });

  it("accepts data:audio/ URLs", () => {
    expect(
      normalizeMediaUrl("data:audio/mp3;base64,SUQzBAAAAAAI"),
    ).toBe("data:audio/mp3;base64,SUQzBAAAAAAI");
  });

  it("accepts data:video/ URLs", () => {
    expect(
      normalizeMediaUrl("data:video/mp4;base64,AAAAIGZ0eXBpc29t"),
    ).toBe("data:video/mp4;base64,AAAAIGZ0eXBpc29t");
  });

  it("rejects data:text/html URLs (XSS risk)", () => {
    expect(normalizeMediaUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("trims whitespace from valid URLs", () => {
    expect(normalizeMediaUrl("  /audio/track.mp3  ")).toBe("/audio/track.mp3");
    expect(
      normalizeMediaUrl("  https://example.com/track.mp3  "),
    ).toBe("https://example.com/track.mp3");
  });

  it("never returns the string 'null'", () => {
    // This is the core regression test — the bug was that null became "null"
    expect(normalizeMediaUrl(null)).not.toBe("null");
    expect(normalizeMediaUrl("null")).not.toBe("null");
    expect(normalizeMediaUrl(undefined)).not.toBe("null");
  });
});

describe("isValidMediaUrl", () => {
  it("returns true for valid URLs", () => {
    expect(isValidMediaUrl("/audio/track.mp3")).toBe(true);
    expect(isValidMediaUrl("https://example.com/track.mp3")).toBe(true);
  });

  it("returns false for invalid URLs", () => {
    expect(isValidMediaUrl(null)).toBe(false);
    expect(isValidMediaUrl("null")).toBe(false);
    expect(isValidMediaUrl(undefined)).toBe(false);
    expect(isValidMediaUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("filterValidMediaUrls", () => {
  it("filters out items with invalid URLs", () => {
    const items = [
      { id: "1", url: "https://example.com/a.mp3" },
      { id: "2", url: null },
      { id: "3", url: "null" },
      { id: "4", url: undefined },
      { id: "5", url: "/audio/b.mp3" },
      { id: "6", url: "file:///C:/track.mp3" },
    ];
    const filtered = filterValidMediaUrls(items);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.id)).toEqual(["1", "5"]);
  });

  it("returns empty array when all URLs are invalid", () => {
    const items = [
      { id: "1", url: null },
      { id: "2", url: "null" },
    ];
    expect(filterValidMediaUrls(items)).toEqual([]);
  });

  it("returns all items when all URLs are valid", () => {
    const items = [
      { id: "1", url: "/audio/a.mp3" },
      { id: "2", url: "https://example.com/b.mp3" },
    ];
    expect(filterValidMediaUrls(items)).toHaveLength(2);
  });
});
