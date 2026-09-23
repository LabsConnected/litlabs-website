import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ActionRunStatusPanel } from "./ActionRunStatusPanel";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ActionRunStatusPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the canonical runtime projection, pending approval, and verified live URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      projection: {
        run: {
          id: "run-12345678",
          status: "waiting_for_user",
          updatedAt: "2026-09-23T00:00:02.000Z",
          cancellationRequestedAt: null,
        },
        displayState: "awaiting_approval",
        currentActivity: "Waiting for deploy approval",
        pendingApprovals: [{ id: "paused-one", toolId: "project.deploy", reason: "Sensitive action" }],
        capabilities: {
          agent: { status: "completed" },
          files: { status: "completed" },
          terminal: { status: "completed" },
          browser: { status: "not_started" },
          preview: { status: "ready" },
          approval: { status: "running" },
          deployment: {
            status: "completed",
            deploymentId: "dep-123",
            publicUrl: "https://site.example.com",
            verified: true,
            error: null,
          },
          verification: { status: "completed" },
        },
        timeline: [
          { id: "e1", type: "tool.completed", createdAt: "2026-09-23T00:00:01.000Z", payload: { toolId: "files.write" } },
          { id: "e2", type: "preview.ready", createdAt: "2026-09-23T00:00:02.000Z", payload: {} },
        ],
        failure: null,
      },
    }));

    render(<ActionRunStatusPanel conversationId="conversation-one" busy={false} />);

    const panel = await screen.findByTestId("action-run-status-panel");
    expect(panel.textContent).toContain("Runtime · Needs approval");
    expect(panel.textContent).toContain("Waiting for deploy approval");
    expect(panel.textContent).toContain("Approval needed: project.deploy");
    expect(panel.textContent).toContain("Preview · ready");
    expect(panel.textContent).toContain("Live URL verified · https://site.example.com");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/studio/conversations/conversation-one/action-run",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );
  });
});
