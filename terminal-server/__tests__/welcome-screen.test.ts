/**
 * LiTT Studio welcome / blank-state screen.
 *
 * The scaffold for a brand-new project must be an honest, polished
 * blank-state of the LiTT builder — never a generic "Hello from LiTTree
 * Studio" placeholder that looks like a broken generated site, and never
 * fake project content.
 */
import { describe, it, expect } from "vitest";
import {
  WELCOME_SCREEN_MARKER,
  WELCOME_PROMPTS,
  buildWelcomeHtml,
  buildWelcomeNextJs,
  buildWelcomeReactVite,
} from "../workspace/welcome-screen";

describe("welcome screen (blank-static HTML)", () => {
  it("carries the LITT-WELCOME-SCREEN marker so the platform can detect the blank state", () => {
    const html = buildWelcomeHtml();
    expect(html).toContain(WELCOME_SCREEN_MARKER);
    expect(html).toContain("The agent MUST replace this file");
  });

  it("shows the welcome copy, not the old generic placeholder", () => {
    const html = buildWelcomeHtml();
    expect(html).not.toContain("Hello from LiTTree Studio");
    expect(html).not.toContain("Start building your project here.");
    expect(html).toContain("Welcome to LiTT");
    expect(html).toContain("Your AI workspace is ready.");
    expect(html).toContain("Workspace ready");
    expect(html).toContain("Start Building");
    expect(html).toContain("Tell LiTT what you want to build");
  });

  it("states plainly that it is a blank workspace, not a project", () => {
    const html = buildWelcomeHtml();
    expect(html).toContain("blank workspace");
    expect(html).toContain("replaced by your actual project");
  });

  it("renders every starter prompt as a clickable chip", () => {
    const html = buildWelcomeHtml();
    expect(WELCOME_PROMPTS.length).toBeGreaterThanOrEqual(3);
    for (const prompt of WELCOME_PROMPTS) {
      expect(html).toContain(`data-starter-prompt="${prompt}"`);
    }
  });

  it("posts litt-welcome messages to the parent window on interaction", () => {
    const html = buildWelcomeHtml();
    expect(html).toContain('source: "litt-welcome"');
    expect(html).toContain('type: "starter-prompt"');
    expect(html).toContain('type: "welcome-cta"');
    expect(html).toContain("window.parent.postMessage");
  });

  it("is a dark, mobile-ready document", () => {
    const html = buildWelcomeHtml();
    expect(html).toContain('name="viewport"');
    expect(html).toContain("#05070d");
    expect(html).toContain("@media (max-width: 480px)");
  });
});

describe("welcome screen (nextjs / react-vite templates)", () => {
  it("nextjs page carries the marker and welcome copy", () => {
    const tsx = buildWelcomeNextJs();
    expect(tsx).toContain(WELCOME_SCREEN_MARKER);
    expect(tsx).not.toContain("Hello from LiTTree Studio");
    expect(tsx).toContain("Welcome to LiTT");
    expect(tsx).toContain("Workspace ready");
    expect(tsx).toContain('"use client"');
    expect(tsx).toContain('source: "litt-welcome"');
    for (const prompt of WELCOME_PROMPTS) {
      expect(tsx).toContain(prompt);
    }
  });

  it("react-vite App carries the marker and welcome copy", () => {
    const tsx = buildWelcomeReactVite();
    expect(tsx).toContain(WELCOME_SCREEN_MARKER);
    expect(tsx).not.toContain("Hello from LiTTree Studio");
    expect(tsx).toContain("Welcome to LiTT");
    expect(tsx).toContain("Workspace ready");
    expect(tsx).toContain("export default function App()");
    expect(tsx).toContain('source: "litt-welcome"');
    for (const prompt of WELCOME_PROMPTS) {
      expect(tsx).toContain(prompt);
    }
  });
});
