import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudioDeploySurface from "./StudioDeploySurface";

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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/deployments")) {
        return { ok: true, json: async () => DEPLOYMENTS_PAYLOAD };
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
