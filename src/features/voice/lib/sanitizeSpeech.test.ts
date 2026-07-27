import { describe, it, expect } from "vitest";
import { sanitizeSpeech } from "./sanitizeSpeech";

describe("sanitizeSpeech", () => {
  it("passes through plain text unchanged", () => {
    expect(sanitizeSpeech("Hello world")).toBe("Hello world");
  });

  it("replaces fenced code blocks with a spoken summary", () => {
    const input = "Here is code:\n```ts\nconst x = 1;\n```\nDone.";
    expect(sanitizeSpeech(input)).toBe(
      "Here is code: I added the code to the workspace. Done.",
    );
  });

  it("unwraps inline code backticks", () => {
    expect(sanitizeSpeech("Run `pnpm dev` now")).toBe("Run pnpm dev now");
  });

  it("strips image markdown but keeps nothing", () => {
    // Image markdown is removed, then whitespace is collapsed — so the double
    // space between "See" and "here" becomes a single space.
    expect(sanitizeSpeech("See ![alt](http://x/y.png) here")).toBe(
      "See here",
    );
  });

  it("unwraps link text from markdown links", () => {
    expect(sanitizeSpeech("Click [here](https://x.com)")).toBe("Click here");
  });

  it("strips heading markers", () => {
    expect(sanitizeSpeech("## Heading")).toBe("Heading");
    expect(sanitizeSpeech("###### Deep heading")).toBe("Deep heading");
  });

  it("strips emphasis characters", () => {
    expect(sanitizeSpeech("**bold** and _italic_ and ~strike~")).toBe(
      "bold and italic and strike",
    );
  });

  it("replaces URLs with a spoken placeholder", () => {
    expect(sanitizeSpeech("Visit https://example.com now")).toBe(
      "Visit the provided link now",
    );
  });

  it("replaces file paths with a spoken placeholder", () => {
    expect(sanitizeSpeech("Edit src/app/page.tsx")).toBe(
      "Edit the referenced file",
    );
    expect(sanitizeSpeech("See components/Button.tsx")).toBe(
      "See the referenced file",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSpeech("  multiple   spaces   ")).toBe("multiple spaces");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeSpeech("   \n\t  ")).toBe("");
  });

  it("handles complex mixed markdown", () => {
    const input = "## Title\n\nSee [link](https://x.com) and `code`:\n```js\nfoo()\n```";
    const result = sanitizeSpeech(input);
    expect(result).toContain("Title");
    expect(result).toContain("link");
    expect(result).toContain("code");
    expect(result).toContain("I added the code to the workspace");
    expect(result).not.toContain("```");
    expect(result).not.toContain("https://");
  });
});
