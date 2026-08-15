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
