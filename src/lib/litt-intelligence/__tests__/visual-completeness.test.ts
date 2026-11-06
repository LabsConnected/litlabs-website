import { describe, expect, it } from "vitest";
import { checkVisualCompleteness } from "../visual-completeness";

function run(contents: Record<string, string>, paths: string[], userRequest?: string) {
  return checkVisualCompleteness({
    contents,
    pathSet: new Set(paths),
    userRequest,
  });
}

describe("checkVisualCompleteness", () => {
  it("passes when every referenced image exists", () => {
    const report = run(
      { "index.html": '<img src="assets/hero.png"><div style="background:url(\'bg.jpg\')">' },
      ["index.html", "assets/hero.png", "bg.jpg"],
    );
    expect(report.ok).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.placeholders).toHaveLength(0);
  });

  it("fails on a referenced image that was never written", () => {
    const report = run(
      { "index.html": '<img src="assets/hero.png">' },
      ["index.html"],
    );
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([{ ref: "assets/hero.png", from: "index.html" }]);
  });

  it("fails on empty and placeholder-domain image sources", () => {
    const report = run(
      {
        "index.html":
          '<img src="https://via.placeholder.com/800x400"><img src="https://picsum.photos/200">',
      },
      ["index.html"],
    );
    expect(report.ok).toBe(false);
    expect(report.placeholders).toHaveLength(2);
  });

  it("fails when the request asked for imagery but none exists", () => {
    const report = run(
      { "index.html": "<h1>After Midnight</h1><p>No pictures here.</p>" },
      ["index.html"],
      "Build a launch page with a hero image and album artwork",
    );
    expect(report.ok).toBe(false);
    expect(report.omittedImagery).toBe(true);
  });

  it("does not flag omission when the request never asked for imagery", () => {
    const report = run(
      { "index.html": "<h1>Docs</h1>" },
      ["index.html"],
      "Write a markdown documentation page",
    );
    expect(report.ok).toBe(true);
    expect(report.omittedImagery).toBe(false);
  });

  it("treats data URIs and real external image URLs as present, not missing", () => {
    const report = run(
      {
        "index.html":
          '<img src="data:image/png;base64,AAAA"><img src="https://cdn.example.com/a.png">',
      },
      ["index.html"],
    );
    expect(report.ok).toBe(true);
    expect(report.external).toHaveLength(1);
    expect(report.missing).toHaveLength(0);
  });

  it("resolves nested relative paths against the referencing file", () => {
    const report = run(
      { "pages/about.html": '<img src="../img/team.jpg">' },
      ["pages/about.html", "img/team.jpg"],
    );
    expect(report.ok).toBe(true);
  });

  it("ignores non-image href/src references", () => {
    const report = run(
      { "index.html": '<a href="/about">x</a><script src="app.js"></script>' },
      ["index.html", "app.js"],
    );
    expect(report.ok).toBe(true);
    expect(report.missing).toHaveLength(0);
  });
});
