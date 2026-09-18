import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingBar } from "../LoadingBar";
import { RouteLoading } from "@/components/route-loading";

describe("LoadingBar (VMA-006 / VMA-024)", () => {
  it("renders the label in the loading copy", () => {
    render(<LoadingBar label="Loading Dashboard" />);
    expect(screen.getByText("Loading Dashboard...")).toBeTruthy();
  });

  it("defaults to a generic 'Loading...' label", () => {
    render(<LoadingBar />);
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("keeps the ⚡-emoji aesthetic while it lasts (M-2 owns the skeleton redesign)", () => {
    const { container } = render(<LoadingBar label="Loading" />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("⚡");
  });

  it("colors the bar with the J1 lime accent token, never a hardcoded hex", () => {
    render(<LoadingBar label="Loading" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("bg-accent");
    expect(bar.style.backgroundColor).toBe("");
    expect(bar.className).not.toContain("#a8ff2f");
  });

  it("drives the bar with the shared .loading-bar class (no inline <style> keyframes)", () => {
    const { container } = render(<LoadingBar label="Loading" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toMatch(/(^|\s)loading-bar(\s|$)/);
    expect(container.querySelectorAll("style").length).toBe(0);
  });

  it("has exactly one animated element — the bar (no double-pulse on emoji/label)", () => {
    const { container } = render(<LoadingBar label="Loading" />);
    const pulsed = container.querySelectorAll(".animate-pulse");
    expect(pulsed.length).toBe(0);
    expect(container.querySelectorAll(".loading-bar").length).toBe(1);
  });

  it("exposes an accessible progressbar", () => {
    render(<LoadingBar label="Loading Studio" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      "Loading Studio in progress"
    );
  });
});

describe("RouteLoading legacy alias (VMA-006)", () => {
  it("delegates to LoadingBar with the same label and no inline keyframes", () => {
    const { container } = render(<RouteLoading label="Loading Discover" />);
    expect(screen.getByText("Loading Discover...")).toBeTruthy();
    expect(container.querySelectorAll("style").length).toBe(0);
    expect(container.querySelectorAll(".loading-bar").length).toBe(1);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("bg-accent");
    expect(bar.style.backgroundColor).toBe("");
  });

  it("defaults to 'Loading...'", () => {
    render(<RouteLoading />);
    expect(screen.getByText("Loading...")).toBeTruthy();
  });
});
