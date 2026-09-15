/**
 * Tests for the web-safe base64url encoder used by LiTT Shell's
 * dev-token fallback. Regression: the old code used Node's Buffer,
 * which does not exist in the Tauri webview and threw ReferenceError.
 */
import { describe, it, expect } from "vitest";
import { encodeBase64Url } from "./runtime-client";

describe("encodeBase64Url", () => {
  it("encodes ASCII bytes to unpadded base64url", () => {
    const bytes = new TextEncoder().encode("hello");
    // "hello" -> aGVsbG8=
    expect(encodeBase64Url(bytes)).toBe("aGVsbG8");
  });

  it("uses URL-safe alphabet (no + or /) and no padding", () => {
    // 0xfb 0xff -> "+/8=" in standard base64 -> "-_8" in base64url
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("round-trips through a base64url decoder", () => {
    const original = JSON.stringify({ sub: "desktop-local-dev", aud: "littree-terminal" });
    const encoded = encodeBase64Url(new TextEncoder().encode(original));
    const standard = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    expect(decoded).toBe(original);
  });

  it("handles empty input", () => {
    expect(encodeBase64Url(new Uint8Array([]))).toBe("");
  });
});
