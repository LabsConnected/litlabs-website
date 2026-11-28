// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 R3 (execution integrity) — referenced-asset existence at build
 * completion (audit D3/D4).
 *
 * The defect: the site-enrich audit computed brokenRefs (local assets
 * the built pages reference that do not exist) and the loop dropped
 * them — only placeholderRefs reached the quality gate, and
 * settleRunOutcome had no asset condition. The first existence check
 * a missing file ever met was the deploy validator at publish (the
 * 2026-11-26 acceptance run discovered its missing images exactly
 * there, after the build had "completed").
 *
 * The contract these tests pin:
 *   - a build whose page references a missing local asset CANNOT
 *     settle as success — the settlement carries a missing_assets
 *     contributor naming the file;
 *   - the bounded in-scope repair (the existing enrichment pass)
 *     runs first: when it repairs the reference, the build settles
 *     clean;
 *   - runs the per-mutation enrichment pass never fires for
 *     (deploy-only shape: no HTML-touching mutation) are verified by
 *     the same audit at the loop tail.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));
// No stock image is ever available: enrichment's repair of a missing
// image reference falls back to the honest local placeholder SVG,
// which exists on disk — the reference is repaired, not faked.
vi.mock("@/lib/site-enrich/resolver", () => ({
  resolveSlotImage: vi.fn(async () => null),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

// A page whose stylesheet references a font file that is never
// written. Enrichment's repair pass deliberately skips non-image CSS
// refs (only image-shaped refs get the image pipeline), so this
// broken reference survives repair deterministically.
const FONT_PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>@font-face { font-family: 'Crust'; src: url('fonts/main.woff2'); }",
  "body { background: #ffffff; color: #1c1917; font-family: 'Crust', sans-serif; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

// A page referencing a hero image that is never written. This one
// enrichment CAN repair (image-shaped ref → placeholder substitution).
const IMG_PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1>",
  '<img src="assets/images/hero.jpg" alt="Fresh croissants on the bakery counter">',
  "<p>Fresh from the oven.</p></body></html>",
].join("\n");

function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    toolCalls: [{ toolCallId, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}
const doneReply = {
  text: "Your bakery site is ready.",
  toolCalls: [],
  finishReason: "stop",
  model: "test-model",
};

/** Directory-aware in-memory transport (static workspace: no git). */
function makeTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    lastCheckpointError: null as string | null,
    createCheckpointBeforeMutation: vi.fn(async () => null),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/$/, "")}/`;
      const entries = new Map<string, string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest) continue;
        const seg = rest.split("/")[0];
        // The real terminal server labels directories "folder" — the
        // mock must match production or the recursion bug it guards
        // against stays invisible (staging acceptance 2026-11-28).
        entries.set(seg, rest.includes("/") ? "folder" : "file");
      }
      return { entries: [...entries].map(([name, type]) => ({ name, type })) };
    }),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

const autoConfig = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "auto" as const,
  enableBuildFix: false,
  isStaticWorkspace: true,
};

describe("P0 R3 — build-completion asset verification", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("a build referencing a missing local asset cannot settle as success", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: FONT_PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      autoConfig,
    );

    const missing = (result.failureContributors ?? []).find((c) => c.kind === "missing_assets");
    expect(missing).toBeDefined();
    expect(missing?.detail).toContain("fonts/main.woff2");
    expect(result.completedWithWarning).toBeUndefined();
    const finished = result.events.find((e) => e.type === "finished");
    expect(finished && "success" in finished ? finished.success : undefined).toBe(false);
  });

  it("settles clean when the enrichment repair fixes the reference first", async () => {
    const { transport, files } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: IMG_PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      autoConfig,
    );

    // The repair actually happened: the placeholder was persisted and
    // the page now references a file that exists.
    expect(files.has("assets/images/placeholder.svg")).toBe(true);
    expect(files.get("index.html")).not.toContain("assets/images/hero.jpg");
    expect(
      (result.failureContributors ?? []).some((c) => c.kind === "missing_assets"),
    ).toBe(false);
    const finished = result.events.find((e) => e.type === "finished");
    expect(finished && "success" in finished ? finished.success : undefined).toBe(true);
  });

  it("verifies runs the enrichment pass never fires for (no HTML-touching mutation)", async () => {
    const { transport, files } = makeTransport();
    // The broken page already sits in the workspace (written by an
    // earlier run); this run only adds a notes file — enrichment's
    // per-mutation gating never triggers, so only the tail
    // verification can catch the dangling reference before a publish
    // would.
    files.set("index.html", FONT_PAGE);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "notes.txt", content: "Opening hours draft" }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Add a notes file to my bakery project",
      transport,
      autoConfig,
    );

    const missing = (result.failureContributors ?? []).find((c) => c.kind === "missing_assets");
    expect(missing).toBeDefined();
    expect(missing?.detail).toContain("fonts/main.woff2");
    const finished = result.events.find((e) => e.type === "finished");
    expect(finished && "success" in finished ? finished.success : undefined).toBe(false);
  });
});
