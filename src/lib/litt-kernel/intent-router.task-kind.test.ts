import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent-router";
import { routeKernel } from "./kernel";

/**
 * ART-20261111-041 — the classification must RECORD that a turn is
 * read-only workspace inspection, not just that it requires execution.
 *
 * Downstream, "requiresExecution" alone conflates two different runs:
 * a build (done = files changed, quality gate demands build/test
 * evidence) and an inspection (done = the read tools answered; the run
 * must never be re-prompted to write files, and the quality gate must
 * not demand build/test evidence it can never produce). The #905
 * inspection pattern group is the single source of that distinction —
 * these tests pin that it survives classification and kernel routing,
 * so consumers never re-derive it from the message text.
 */

const LIST_MESSAGE =
  "List the files in the project I'm currently viewing. Just list them, don't change anything.";

describe("intent classification — inspection task kind", () => {
  it("marks a pure file-listing request as inspection (execution, but read-only)", () => {
    const intent = classifyIntent(LIST_MESSAGE, { hasProject: true });
    expect(intent.mode).toBe("build");
    expect(intent.requiresExecution).toBe(true);
    expect(intent.taskKind).toBe("inspection");
  });

  it("marks a named-file read as inspection", () => {
    const intent = classifyIntent("read index.html", { hasProject: true });
    expect(intent.requiresExecution).toBe(true);
    expect(intent.taskKind).toBe("inspection");
  });

  it("marks a folder-contents question as inspection", () => {
    const intent = classifyIntent("what's in the src folder?", { hasProject: true });
    expect(intent.taskKind).toBe("inspection");
  });

  it("does NOT mark a build request as inspection", () => {
    const intent = classifyIntent("Build me a landing page for my bakery", { hasProject: true });
    expect(intent.requiresExecution).toBe(true);
    expect(intent.taskKind).toBeUndefined();
  });

  it("does NOT mark a file mutation as inspection", () => {
    const intent = classifyIntent("fix the typo in index.html", { hasProject: true });
    expect(intent.requiresExecution).toBe(true);
    expect(intent.taskKind).toBeUndefined();
  });

  it("does NOT mark a question ABOUT a file as inspection", () => {
    const intent = classifyIntent("what does index.html do?", { hasProject: true });
    expect(intent.requiresExecution).toBe(false);
    expect(intent.taskKind).toBeUndefined();
  });

  it("kernel routing carries the inspection task kind to consumers", () => {
    // No capabilities are supplied, so routeKernel reports ok:false
    // (execution blocked) — but the DECISION, which is what consumers
    // read routing from, is returned on both variants.
    const result = routeKernel({
      message: LIST_MESSAGE,
      userId: "user-1",
      conversationId: "conv-1",
      projectId: "proj-1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
    expect(result.decision.routing.taskKind).toBe("inspection");
  });

  it("kernel routing leaves the task kind unset for a mutation build", () => {
    const result = routeKernel({
      message: "Build me a landing page for my bakery",
      userId: "user-1",
      conversationId: "conv-1",
      projectId: "proj-1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
    expect(result.decision.routing.taskKind).toBeUndefined();
  });
});
