"use client";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, act, within } from "@testing-library/react";
import BrowserJobLiveView, { collectSnapshots } from "./BrowserJobLiveView";
import type { AgentJobEvent } from "../hooks/useBrowserJobEvents";
import type { BrowserJob } from "../hooks/useBrowserJobs";

/**
 * Agent Browser Phase 6 — owner live view, done right.
 *
 *  1. The endpoint says "unavailable" → honest fallback: the latest
 *     labeled snapshot + a timestamped snapshot timeline (each labeled
 *     SNAPSHOT — a carousel is not a live browser).
 *  2. The endpoint says "live" → the iframe embeds the embed URL, with
 *     the LIVE badge.
 *  3. Browserbase's documented `browserbase-disconnected` postMessage
 *     (origin-validated) flips a live view to "disconnected" immediately.
 *  4. A disconnect message from a non-Browserbase origin is ignored.
 */

const EARLIER = new Date("2026-09-18T11:58:00Z").toISOString();

function jobFixture(overrides: Partial<BrowserJob> = {}): BrowserJob {
  return {
    jobId: "job-1",
    jobType: "ghl.workflow.inspect",
    goal: "Inspect workflow",
    riskLevel: "low",
    requestedBy: "studio",
    status: "running",
    params: {},
    result: { screenshotUrl: "data:image/png;base64,RESULT" },
    error: null,
    progress: { step: 1, totalSteps: 2, steps: [] },
    browserSessionId: "sess-1",
    liveViewUrl: "https://www.browserbase.com/sessions/bb-1",
    approvedBy: null,
    approvedAt: null,
    attempts: 1,
    createdAt: EARLIER,
    startedAt: EARLIER,
    completedAt: null,
    ...overrides,
  };
}

function eventFixture(overrides: Partial<AgentJobEvent> = {}): AgentJobEvent {
  return {
    id: "e1",
    jobId: "job-1",
    type: "observation",
    step: 2,
    message: "Login page observed",
    metadata: { screenshotUrl: "data:image/png;base64,EVT1" },
    createdAt: EARLIER,
    ...overrides,
  };
}

function probeResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectSnapshots", () => {
  it("collects event + result screenshots oldest-first, labeled and timestamped", () => {
    const snaps = collectSnapshots(jobFixture(), [eventFixture()]);
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({ caption: "Login page observed", createdAt: EARLIER });
    expect(snaps[1]).toMatchObject({ caption: "Final snapshot" });
    expect(snaps[0].url).toMatch(/^data:image\/png;base64,/);
  });

  it("skips non-image metadata and empty results", () => {
    const snaps = collectSnapshots(
      jobFixture({ result: null }),
      [eventFixture({ metadata: {} })],
    );
    expect(snaps).toHaveLength(0);
  });
});

describe("collectSnapshots — step provenance", () => {
  const STEP_URL = "https://app.gohighlevel.com/v2/location/abc/workflows";

  function jobWithStepScreenshot() {
    return jobFixture({
      result: null,
      progress: {
        step: 1,
        totalSteps: 2,
        steps: [
          { label: "Start browser session", status: "completed" },
          {
            label: "Navigate to workflows",
            status: "completed",
            url: STEP_URL,
            screenshotUrl: "data:image/png;base64,STEP1",
          },
        ],
      },
    });
  }

  it("captions step screenshots with the exact URL captured — route-accurate", () => {
    const snaps = collectSnapshots(jobWithStepScreenshot(), []);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      id: "step-1",
      url: "data:image/png;base64,STEP1",
      caption: `Captured at ${STEP_URL}`,
    });
  });

  it("dedupes a frame emitted both as an event and on a step", () => {
    const snaps = collectSnapshots(jobWithStepScreenshot(), [
      eventFixture({ metadata: { screenshotUrl: "data:image/png;base64,STEP1" } }),
    ]);
    const urls = snaps.map((s) => s.url);
    expect(urls.filter((u) => u === "data:image/png;base64,STEP1")).toHaveLength(1);
  });

  it("falls back to step label when the URL was not recorded", () => {
    const snaps = collectSnapshots(
      jobFixture({
        result: null,
        progress: {
          step: 0,
          totalSteps: 1,
          steps: [
            { label: "Start browser session", status: "completed", screenshotUrl: "data:image/png;base64,NOURL" },
          ],
        },
      }),
      [],
    );
    expect(snaps).toHaveLength(1);
    expect(snaps[0].caption).toContain("Start browser session");
  });
});

describe("BrowserJobLiveView", () => {
  it("renders the honest fallback when the live view is unavailable", async () => {
    fetchMock.mockResolvedValue(
      probeResponse({
        available: false,
        reason: "session_closed",
        embedUrl: null,
        openUrl: "https://www.browserbase.com/sessions/bb-1",
        sessionStatus: "closed",
      }),
    );

    render(<BrowserJobLiveView job={jobFixture()} events={[eventFixture()]} />);

    const fallback = await screen.findByTestId("live-view-fallback");
    expect(fallback).toHaveTextContent("Session closed — snapshots below");
    expect(fallback).toHaveTextContent("The browser session has ended");
    // Snapshot timeline: each snapshot labeled SNAPSHOT, not "live".
    const timeline = await screen.findByTestId("snapshot-timeline");
    expect(within(timeline).getAllByText("SNAPSHOT").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("live-view-iframe-wrap")).toBeNull();
    expect(screen.queryByTestId("live-view-live-badge")).toBeNull();
  });

  it("embeds the iframe with the LIVE badge when the endpoint says live", async () => {
    fetchMock.mockResolvedValue(
      probeResponse({
        available: true,
        reason: "live",
        embedUrl: "https://debug.example/s/bb-1?fullscreen=1&navbar=false",
        openUrl: "https://www.browserbase.com/sessions/bb-1",
        sessionStatus: "active",
      }),
    );

    render(<BrowserJobLiveView job={jobFixture()} events={[]} />);

    const wrap = await screen.findByTestId("live-view-iframe-wrap");
    const iframe = wrap.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      "https://debug.example/s/bb-1?fullscreen=1&navbar=false",
    );
    expect(await screen.findByTestId("live-view-live-badge")).toHaveTextContent("LIVE");
    expect(screen.queryByTestId("live-view-fallback")).toBeNull();
  });

  it("flips to disconnected immediately on the browserbase-disconnected signal", async () => {
    fetchMock
      .mockResolvedValueOnce(
        probeResponse({
          available: true,
          reason: "live",
          embedUrl: "https://debug.example/s/bb-1",
          openUrl: "https://www.browserbase.com/sessions/bb-1",
          sessionStatus: "active",
        }),
      )
      // The confirm re-probe after the signal: the session is gone.
      .mockResolvedValue(
        probeResponse({
          available: false,
          reason: "session_closed",
          embedUrl: null,
          openUrl: "https://www.browserbase.com/sessions/bb-1",
          sessionStatus: "closed",
        }),
      );

    render(<BrowserJobLiveView job={jobFixture()} events={[eventFixture()]} />);
    await screen.findByTestId("live-view-iframe-wrap");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "browserbase-disconnected",
          origin: "https://www.browserbase.com",
        }),
      );
    });

    const disconnected = await screen.findByTestId("live-view-disconnected");
    expect(disconnected).toHaveTextContent("Disconnected — latest snapshot below");
    expect(screen.queryByTestId("live-view-iframe-wrap")).toBeNull();
  });

  it("ignores disconnect signals from non-Browserbase origins", async () => {
    fetchMock.mockResolvedValue(
      probeResponse({
        available: true,
        reason: "live",
        embedUrl: "https://debug.example/s/bb-1",
        openUrl: "https://www.browserbase.com/sessions/bb-1",
        sessionStatus: "active",
      }),
    );

    render(<BrowserJobLiveView job={jobFixture()} events={[]} />);
    await screen.findByTestId("live-view-iframe-wrap");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "browserbase-disconnected",
          origin: "https://evil.example",
        }),
      );
    });

    // Still live — the spoofed signal was ignored.
    expect(await screen.findByTestId("live-view-iframe-wrap")).not.toBeNull();
    expect(screen.queryByTestId("live-view-disconnected")).toBeNull();
  });

  it("keeps its state when the probe fails (a blip is not a disconnect)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    render(<BrowserJobLiveView job={jobFixture()} events={[]} />);

    // The "checking" skeleton stays — no confident wrong flip.
    expect(await screen.findByText("Checking live view…")).not.toBeNull();
    expect(screen.queryByTestId("live-view-fallback")).toBeNull();
    expect(screen.queryByTestId("live-view-disconnected")).toBeNull();
  });
});
