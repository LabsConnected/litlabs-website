import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OwnerTestModeIndicator } from "./OwnerTestModeIndicator";

/**
 * Regression test for the "Testing As" dropdown dark-on-dark bug
 * (TESTING-AS-DIAGNOSIS.md, Finding 1): the menu was portaled to
 * document.body, outside the .studio-shell scope that gives --studio-bg
 * its light value, so it painted the :root near-black #08060f while its
 * text inherited the light pack's dark ink (~1.3:1 contrast) — and the
 * header/description/footer opacities (0.5/0.5/0.4) halved it further.
 *
 * The fix portals the menu into the .studio-shell subtree and gives the
 * menu explicit same-scope colors (text set on the container, muted
 * text via --text-* tokens instead of opacity). These tests pin both.
 */

const OPTIONS = [
  { value: "owner", label: "OWNER", description: "Full owner access — all features, unlimited projects" },
  { value: "starter", label: "Starter", description: "1 project, 1,500 LiTTBits (one-time), no premium models" },
  { value: "creator_beta", label: "Creator", description: "5 projects, 7.5K LiTTBits/mo, voice + GitHub" },
  { value: "pro_builder_beta", label: "Pro Builder", description: "25 projects, 18K LiTTBits/mo, terminal + premium models" },
  { value: "zero_bits", label: "Zero-LiTTBits Test", description: "Owner access but balance treated as 0" },
] as const;

function stubOwnerFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ isOwner: true, simulation: null, options: OPTIONS }),
    })),
  );
}

describe("OwnerTestModeIndicator — Testing As menu visibility", () => {
  beforeEach(() => {
    stubOwnerFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("portals the open menu into the .studio-shell subtree, not document.body", async () => {
    const { container } = render(
      <div className="studio-shell">
        <OwnerTestModeIndicator placement="inline" />
      </div>,
    );

    const badge = await screen.findByRole("button", { name: /OWNER/ });
    fireEvent.click(badge);

    const menu = await screen.findByRole("menu");
    const shell = container.querySelector(".studio-shell");
    expect(shell).not.toBeNull();
    // The menu must live inside the shell scope so --studio-bg and the
    // --text-* tokens resolve to their light values…
    expect(shell!.contains(menu)).toBe(true);
    // …and must NOT be a direct child of <body> (the old broken portal).
    expect(menu.parentElement).not.toBe(document.body);
  });

  it("styles the menu with explicit same-scope colors and no contrast-halving opacity", async () => {
    render(
      <div className="studio-shell">
        <OwnerTestModeIndicator placement="inline" />
      </div>,
    );

    const badge = await screen.findByRole("button", { name: /OWNER/ });
    fireEvent.click(badge);

    const menu = await screen.findByRole("menu");
    // Background and text both come from the shell's token scope, with
    // light fallbacks — never the old :root-dark background pairing.
    expect(menu.style.background).toContain("var(--studio-bg");
    expect(menu.style.background).not.toContain("#1a1a1a");
    expect(menu.style.color).toContain("var(--text-primary");

    // Header: no more opacity 0.5 — muted via the secondary text token.
    const header = screen.getByText("Testing as");
    expect(header.style.opacity).toBe("");
    expect(header.style.color).toContain("var(--text-secondary");

    // Option descriptions: no more opacity 0.5 — muted text token.
    const description = screen.getByText(/1 project, 1,500 LiTTBits/);
    expect(description.style.opacity).toBe("");
    expect(description.style.color).toContain("var(--text-muted");

    // Footer: no more opacity 0.4 — muted text token.
    const footer = screen.getByText(/Simulation never modifies Stripe/);
    expect(footer.style.opacity).toBe("");
    expect(footer.style.color).toContain("var(--text-muted");
  });
});
