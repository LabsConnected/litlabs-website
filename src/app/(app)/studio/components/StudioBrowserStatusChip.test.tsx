"use client";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StudioBrowserStatusChip from "./StudioBrowserStatusChip";
import type { BrowserSessionStatus } from "../hooks/useBrowserSessionStatus";

/**
 * Phase 3 — cooperative control UI. The Take control / Resume buttons are
 * the chat-visible wiring for the session manager's takeControl /
 * returnControl; the chip must show exactly the control state the server
 * reports (same honesty contract as the live/disconnected states).
 */

const takeControl = vi.fn();
const returnControl = vi.fn();
const stop = vi.fn();

let mockStatus: BrowserSessionStatus = {
  state: "disconnected",
  sessionId: null,
  controller: null,
  sessionStatus: null,
  lastActivityAt: null,
  burn: null,
};
let mockLiveViewUrl: string | null = null;

vi.mock("../hooks/useBrowserSessionStatus", () => ({
  useBrowserSessionStatus: () => ({
    status: mockStatus,
    error: null,
    stopping: false,
    refresh: vi.fn(),
    stop,
    controlBusy: false,
    liveViewUrl: mockLiveViewUrl,
    takeControl,
    returnControl,
  }),
}));

beforeEach(() => {
  takeControl.mockClear();
  returnControl.mockClear();
  stop.mockClear();
  mockLiveViewUrl = null;
  mockStatus = {
    state: "disconnected",
    sessionId: null,
    controller: null,
    sessionStatus: null,
    lastActivityAt: null,
    burn: null,
  };
});

describe("StudioBrowserStatusChip — cooperative control", () => {
  it("offers Take control while the agent holds a live session", () => {
    mockStatus = {
      state: "live",
      sessionId: "sess-1",
      controller: "agent",
      sessionStatus: "agent_control",
      lastActivityAt: new Date().toISOString(),
      burn: { billableMinutes: 3, modelCalls: 2, bits: 155, live: true },
    };
    render(<StudioBrowserStatusChip />);
    expect(screen.getByTestId("browser-take-control")).toBeTruthy();
    expect(screen.queryByTestId("browser-resume")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-take-control"));
    expect(takeControl).toHaveBeenCalledTimes(1);
  });

  it("shows the human-control state with live view link and Resume", () => {
    mockStatus = {
      state: "idle",
      sessionId: "sess-1",
      controller: "human",
      sessionStatus: "human_control",
      lastActivityAt: new Date().toISOString(),
      burn: { billableMinutes: 3, modelCalls: 2, bits: 155, live: true },
    };
    mockLiveViewUrl = "https://www.browserbase.com/sessions/bb-1";
    render(<StudioBrowserStatusChip />);

    // Phase 4 — the burn segment comes from the real accumulator.
    expect(screen.getByText("Browser · You have control · 3 min · 155 LiTTBits")).toBeTruthy();
    expect(screen.getByTestId("browser-resume")).toBeTruthy();
    expect(screen.queryByTestId("browser-take-control")).toBeNull();
    const liveView = screen.getByTestId("browser-live-view");
    expect(liveView.getAttribute("href")).toBe(
      "https://www.browserbase.com/sessions/bb-1",
    );
    expect(screen.getByTestId("browser-human-hint")).toBeTruthy();

    fireEvent.click(screen.getByTestId("browser-resume"));
    expect(returnControl).toHaveBeenCalledTimes(1);
  });

  it("shows no control buttons when disconnected", () => {
    render(<StudioBrowserStatusChip />);
    expect(screen.getByText("Browser · Disconnected")).toBeTruthy();
    expect(screen.queryByTestId("browser-take-control")).toBeNull();
    expect(screen.queryByTestId("browser-resume")).toBeNull();
  });
});

describe("StudioBrowserStatusChip — live burn display (Phase 4)", () => {
  it("renders the real accumulator burn on a live session", () => {
    mockStatus = {
      state: "live",
      sessionId: "sess-1",
      controller: "agent",
      sessionStatus: "active",
      lastActivityAt: new Date().toISOString(),
      burn: { billableMinutes: 3, modelCalls: 2, bits: 155, live: true },
    };
    render(<StudioBrowserStatusChip />);
    expect(
      screen.getByText("Browser · Live · 3 min · 155 LiTTBits"),
    ).toBeTruthy();
  });

  it("shows no burn segment when the probe knows nothing (never a fake number)", () => {
    mockStatus = {
      state: "live",
      sessionId: "sess-1",
      controller: "agent",
      sessionStatus: "active",
      lastActivityAt: new Date().toISOString(),
      burn: null,
    };
    render(<StudioBrowserStatusChip />);
    expect(screen.getByText("Browser · Live")).toBeTruthy();
  });
});
