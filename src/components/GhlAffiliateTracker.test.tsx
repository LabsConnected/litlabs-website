import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GhlAffiliateScript } from "./GhlAffiliateTracker";
import { saveConsent } from "@/lib/cookie-consent";

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => <div data-testid="affiliate-script" data-src={src} />,
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: false, isSignedIn: false, user: null }),
}));

describe("affiliate script consent gate", () => {
  it("does not load external affiliate code before explicit opt-in", () => {
    render(<GhlAffiliateScript />);
    expect(screen.queryByTestId("affiliate-script")).toBeNull();
  });

  it("loads only after marketing consent, and unmounts after withdrawal", () => {
    render(<GhlAffiliateScript />);
    act(() => {
      saveConsent({ preferences: false, analytics: false, marketing: true });
    });
    expect(screen.getByTestId("affiliate-script").getAttribute("data-src"))
      .toBe("https://link.msgsndr.com/js/am.js");

    act(() => {
      saveConsent({ preferences: false, analytics: false, marketing: false });
    });
    expect(screen.queryByTestId("affiliate-script")).toBeNull();
    expect(window.localStorage.getItem("litt:ghl:am_id")).toBeNull();
  });
});
