import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioTour } from "./StudioTour";

const EXPECTED_STEPS = [
  "The brief",
  "The plan",
  "The build",
  "The preview",
  "Real session",
];

/** jsdom has no matchMedia; the tour reads it for reduced-motion. */
function stubMatchMedia(matches: boolean) {
  const mq = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mq),
  );
  return mq;
}

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudioTour truthful labeling", () => {
  it("labels the tour as recorded in the eyebrow and the Studio chrome", () => {
    render(<StudioTour />);
    const badges = screen.getAllByText(/recorded tour/i);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("discloses that nothing is live or interactive", () => {
    render(<StudioTour />);
    expect(
      screen.getByText(/nothing here is interactive/i),
    ).toBeInTheDocument();
  });

  it("never claims the tour itself is live or real-time", () => {
    const { container } = render(<StudioTour />);
    // The "/demo" CTA legitimately advertises the *real* demo lane, so
    // exclude its text from the scan — everything else must not use the
    // words "live" or "real-time" to describe this canned tour.
    const demoCta = container.querySelector('a[href="/demo"]');
    const ctaText = demoCta?.textContent ?? "";
    const rest = (container.textContent ?? "").replace(ctaText, "");
    expect(rest).not.toMatch(/\blive\b/i);
    expect(rest).not.toMatch(/real[\s-]?time/i);
  });

  it("has no simulated chat input pretending to call the model", () => {
    const { container } = render(<StudioTour />);
    expect(
      container.querySelector('input[type="text"], textarea'),
    ).toBeNull();
  });
});

describe("StudioTour steps and playback", () => {
  it("renders all five tour steps in the stepper", () => {
    render(<StudioTour />);
    for (const label of EXPECTED_STEPS) {
      expect(
        screen.getByRole("button", { name: new RegExp(`step \\d+: ${label}`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("starts on step 1 and advances with next/previous controls", () => {
    render(<StudioTour />);
    const region = screen.getByRole("region", {
      name: /tour step 1 of 5/i,
    });
    expect(region).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next tour step/i }));
    expect(
      screen.getByRole("region", { name: /tour step 2 of 5/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /previous tour step/i }),
    );
    expect(
      screen.getByRole("region", { name: /tour step 1 of 5/i }),
    ).toBeInTheDocument();
  });

  it("integrates the real trailer as the final step", () => {
    render(<StudioTour />);
    const next = screen.getByRole("button", { name: /next tour step/i });
    for (let i = 0; i < 4; i++) fireEvent.click(next);
    expect(
      screen.getByRole("region", { name: /tour step 5 of 5/i }),
    ).toBeInTheDocument();
    const video = screen.getByLabelText(/recorded litt product trailer/i);
    expect(video).toBeInTheDocument();
    expect(
      video.querySelector('source[src="/demos/litt-trailer.webm"]'),
    ).not.toBeNull();
    expect(
      video.querySelector('source[src="/demos/litt-trailer.mp4"]'),
    ).not.toBeNull();
  });

  it("stays on step 1 when the user prefers reduced motion", () => {
    stubMatchMedia(true);
    render(<StudioTour />);
    const pause = screen.getByRole("button", {
      name: /play the tour/i,
    });
    // Autoplay is off for reduced motion: the control offers to play.
    expect(pause).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /tour step 1 of 5/i }),
    ).toBeInTheDocument();
  });
});

describe("StudioTour CTAs", () => {
  it("links 'Try the live demo' exactly to /demo", () => {
    render(<StudioTour />);
    const link = screen.getByRole("link", { name: /try the live demo/i });
    expect(link.getAttribute("href")).toBe("/demo");
  });

  it("links 'Start building free' exactly to /sign-up", () => {
    render(<StudioTour />);
    const link = screen.getByRole("link", { name: /start building free/i });
    expect(link.getAttribute("href")).toBe("/sign-up");
  });
});
