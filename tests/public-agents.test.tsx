// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentsCatalog } from "@/app/(marketing)/agents/AgentsCatalog";
import { AGENT_DEFINITIONS } from "@/lib/agent-registry";

describe("public Agents discovery", () => {
  it("shows real registry specialists without requiring a session", () => {
    render(<AgentsCatalog signedIn={false} />);
    expect(screen.getByRole("heading", { name: "One LiTT. Specialist support." })).toBeTruthy();
    for (const agent of AGENT_DEFINITIONS.filter((entry) => entry.enabled && entry.studioVisible)) {
      expect(screen.getByRole("heading", { name: agent.name })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Open agents in Studio" }).getAttribute("href")).toBe("/studio?tool=agents");
    expect(screen.getByTestId("agents-session-note").textContent).toMatch(/Sign in or create an account/i);
  });

  it("does not tell a signed-in user to create an account", () => {
    render(<AgentsCatalog signedIn />);
    const note = screen.getByTestId("agents-session-note");
    expect(note.textContent).toMatch(/signed in/i);
    expect(note.textContent).not.toMatch(/Sign in or create an account/i);
  });
  it("keeps public index discovery separate from protected Studio actions", () => {
    const config = readFileSync(resolve("next.config.ts"), "utf8");
    expect(config).not.toMatch(/source:\s*["']\/agents["']/);
    const footer = readFileSync(resolve("src/components/marketing/MarketingFooter.tsx"), "utf8");
    expect(footer).toContain('href="/agents"');
  });
});
