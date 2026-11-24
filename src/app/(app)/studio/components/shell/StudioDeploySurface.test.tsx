import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudioDeploySurface from "./StudioDeploySurface";
import { useExecutionStore } from "../../stores/useExecutionStore";

/**
 * StudioDeploySurface — ACC-01 F8a + F8b.
 *
 * F8a: the address the surface presents for LiTT Hosting is the
 * project's ONE stable public URL (always the latest publish), not
 * the rotating per-deployment snapshot URL.
 *
 * F8b: "Redeploy with LiTT" used to be a silent no-op from the user's
 * seat — the click must dispatch the deploy request AND the surface
 * must acknowledge the hand-off to LiTT where the click happened.
 */

const DEPLOYMENTS_PAYLOAD = {
  deployment: {
    id: "dep-2",
    status: "ready",
    target: "litt-static",
    publicUrl: "https://example.litt.host/sites/dep-2/",
    urlVerified: true,
    fileCount: 7,
    createdAt: "2026-11-23T16:44:01.000Z",
    updatedAt: "2026-11-23T16:44:01.000Z",
  },
  stablePublicUrl: "https://hosting.example.test/sites/project/proj-1/",
  latestByTarget: {
    "litt-static": {
      id: "dep-2",
      status: "ready",
      target: "litt-static",
      publicUrl: "https://example.litt.host/sites/dep-2/",
      urlVerified: true,
      fileCount: 7,
      createdAt: "2026-11-23T16:44:01.000Z",
      updatedAt: "2026-11-23T16:44:01.000Z",
    },
    netlify: null,
  },
  history: [
    {
      id: "dep-2",
      status: "ready",
      target: "litt-static",
      publicUrl: "https://example.litt.host/sites/dep-2/",
      createdAt: "2026-11-23T16:44:01.000Z",
    },
    {
      id: "dep-1",
      status: "ready",
      target: "litt-static",
      publicUrl: "https://example.litt.host/sites/dep-1/",
      createdAt: "2026-11-23T16:29:30.000Z",
    },
  ],
  netlifyConnection: { connected: false, accountName: null },
  hosting: { name: "LiTT Hosting", configured: true },
  project: { workspaceStatus: "ready" },
};

const NOT_DEPLOYED_PAYLOAD = {
  deployment: null,
  stablePublicUrl: null,
  latestByTarget: { "litt-static": null, netlify: null },
  history: [],
  netlifyConnection: { connected: false, accountName: null },
  hosting: { name: "LiTT Hosting", configured: true },
  project: { workspaceStatus: "ready" },
};

let deploymentsPayload: unknown = DEPLOYMENTS_PAYLOAD;
let deploymentsFetchCount = 0;

beforeEach(() => {
  deploymentsPayload = DEPLOYMENTS_PAYLOAD;
  deploymentsFetchCount = 0;
  useExecutionStore.setState({ isRunning: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/deployments")) {
        deploymentsFetchCount += 1;
        return { ok: true, json: async () => deploymentsPayload };
      }
      if (url.includes("/checks")) {
        return { ok: true, json: async () => ({ checks: [] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useExecutionStore.setState({ isRunning: false });
});

describe("StudioDeploySurface — deploy request + stable URL", () => {
  it("presents the STABLE project URL as the live address, not the snapshot URL", async () => {
    render(<StudioDeploySurface projectId="proj-1" onDeployRequest={vi.fn()} />);
    const link = await screen.findByTestId("deploy-live-url");
    expect(link).toHaveAttribute(
      "href",
      "https://hosting.example.test/sites/project/proj-1/",
    );
    expect(link.textContent).toContain("sites/project/proj-1");
  });

  it("clicking Redeploy dispatches the request and acknowledges the hand-off", async () => {
    const onDeployRequest = vi.fn();
    render(<StudioDeploySurface projectId="proj-1" onDeployRequest={onDeployRequest} />);

    const button = await screen.findByTestId("deploy-surface-deploy");
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByTestId("deploy-request-sent")).toBeNull();

    fireEvent.click(button);

    expect(onDeployRequest).toHaveBeenCalledWith("litt");
    // The surface itself says where the request went — no silent click.
    expect(screen.getByTestId("deploy-request-sent")).toHaveTextContent(
      /Sent to LiTT/,
    );
  });
});

describe("StudioDeploySurface — refresh after a chat-driven deploy (ACC-03 item 4)", () => {
  it("re-reads deployment state when a run completes, so Redeploy appears without a reload", async () => {
    deploymentsPayload = NOT_DEPLOYED_PAYLOAD;
    const onDeployRequest = vi.fn();
    render(<StudioDeploySurface projectId="proj-1" onDeployRequest={onDeployRequest} />);

    // Stale starting state: nothing deployed yet.
    expect(
      await screen.findByText(/has not been deployed to LiTT Hosting yet/),
    ).toBeTruthy();
    expect(screen.getByTestId("deploy-surface-deploy")).toHaveTextContent(
      "Deploy with LiTT",
    );
    const fetchesBefore = deploymentsFetchCount;

    // A deploy runs through chat (the canonical path) and completes:
    // the server now holds a ready deployment.
    deploymentsPayload = DEPLOYMENTS_PAYLOAD;
    act(() => {
      useExecutionStore.setState({ isRunning: true });
    });
    act(() => {
      useExecutionStore.setState({ isRunning: false });
    });

    // The surface must refresh IN PLACE: stable URL, history, and the
    // Redeploy label — no page reload involved.
    const link = await screen.findByTestId("deploy-live-url");
    expect(link).toHaveAttribute(
      "href",
      "https://hosting.example.test/sites/project/proj-1/",
    );
    expect(deploymentsFetchCount).toBeGreaterThan(fetchesBefore);
    const button = screen.getByTestId("deploy-surface-deploy");
    expect(button).toHaveTextContent("Redeploy with LiTT");

    // And the F8b hand-off works from the refreshed state.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(onDeployRequest).toHaveBeenCalledWith("litt");
    expect(screen.getByTestId("deploy-request-sent")).toHaveTextContent(
      /Sent to LiTT/,
    );
  });

  it("re-reads deployment state on a files-changed signal for the project", async () => {
    deploymentsPayload = NOT_DEPLOYED_PAYLOAD;
    render(<StudioDeploySurface projectId="proj-1" onDeployRequest={vi.fn()} />);
    expect(
      await screen.findByText(/has not been deployed to LiTT Hosting yet/),
    ).toBeTruthy();
    const fetchesBefore = deploymentsFetchCount;

    deploymentsPayload = DEPLOYMENTS_PAYLOAD;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("studio:files-changed", { detail: { projectId: "proj-1" } }),
      );
    });

    expect(await screen.findByTestId("deploy-live-url")).toBeTruthy();
    expect(deploymentsFetchCount).toBeGreaterThan(fetchesBefore);
  });
});
