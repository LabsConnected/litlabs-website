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
    };
    mockLiveViewUrl = "https://www.browserbase.com/sessions/bb-1";
    render(<StudioBrowserStatusChip />);

    expect(screen.getByText("Browser · You have control")).toBeTruthy();
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
