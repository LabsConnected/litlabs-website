import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import LiTTPresence from "@/app/(app)/studio/components/LiTTPresence";

describe("LiTTPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty-state variant with correct aria-label", () => {
    const { container } = render(
      <LiTTPresence state="idle" variant="empty-state" size="md" />,
    );
    const el = container.querySelector('[aria-label="LiTT idle"]');
    expect(el).not.toBeNull();
  });

  it("renders chat-avatar variant as a circle", () => {
    const { container } = render(
      <LiTTPresence state="thinking" variant="chat-avatar" size="md" />,
    );
    const el = container.querySelector('[aria-label="LiTT thinking"]');
    expect(el).not.toBeNull();
    expect(el?.className).toContain("rounded-full");
  });

  it("renders terminal variant", () => {
    const { container } = render(
      <LiTTPresence state="working" variant="terminal" size="sm" />,
    );
    const el = container.querySelector('[aria-label="LiTT working"]');
    expect(el).not.toBeNull();
  });

  it("renders error state with flicker animation class", () => {
    const { container } = render(
      <LiTTPresence state="error" variant="empty-state" size="md" />,
    );
    const el = container.querySelector('[aria-label="LiTT error"]');
    expect(el).not.toBeNull();
    // The animation class is applied to the container div
    expect(el?.className).toContain("litt-flicker-error");
  });

  it("renders success state", () => {
    const { container } = render(
      <LiTTPresence state="success" variant="empty-state" size="lg" />,
    );
    const el = container.querySelector('[aria-label="LiTT success"]');
    expect(el).not.toBeNull();
  });

  it("renders listening state", () => {
    const { container } = render(
      <LiTTPresence state="listening" variant="chat-avatar" size="sm" />,
    );
    const el = container.querySelector('[aria-label="LiTT listening"]');
    expect(el).not.toBeNull();
  });
});

describe("LiTTPresence — F1 brand consolidation (slice B)", () => {
  const BRAND_ALT = "LiTTree LabStudios Logo";

  it.each([
    ["chat-avatar", "thinking", "md"],
    ["terminal", "working", "sm"],
    ["empty-state", "idle", "md"],
  ] as const)("variant %s renders the canonical BrandLogo mark", (variant, state, size) => {
    const { container } = render(
      <LiTTPresence state={state} variant={variant} size={size} />,
    );
    const logo = container.querySelector(`img[alt="${BRAND_ALT}"]`);
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("src")).toContain("littree-crystal-mark");
  });

  it.each([
    ["chat-avatar", "thinking", "md"],
    ["terminal", "working", "sm"],
    ["empty-state", "idle", "md"],
  ] as const)("variant %s no longer references invented webp cutouts", (variant, state, size) => {
    const { container } = render(
      <LiTTPresence state={state} variant={variant} size={size} />,
    );
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("src") ?? "").not.toContain("/brand/litt/");
    }
  });

  it("keeps presence semantics — state ring color on the avatar container", () => {
    const { container } = render(
      <LiTTPresence state="error" variant="chat-avatar" size="md" />,
    );
    const el = container.querySelector('[aria-label="LiTT error"]');
    expect(el).not.toBeNull();
    // Error state still uses the red ring, not the accent (jsdom inserts
    // spaces in rgba(), so match loosely).
    expect((el as HTMLElement).style.border).toMatch(/239,\s*68,\s*68/);
  });
});
