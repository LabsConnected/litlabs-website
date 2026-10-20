// @vitest-environment node
/**
 * Regression: staging preview + verification failures (run 0c5b5074,
 * staging head 47824457). Diagnosis ART-20261020-007; test intent from the
 * Lane B drafted patch ART-20261020-008 (that artifact is a prose draft
 * whose T1/T1b/T2/T3 bodies are commented placeholders — it is not
 * git-applicable; this file activates the same four tests against the
 * implemented seams, with no behavior invented beyond the diagnosis).
 *
 * Environment contract being simulated (PROVEN on staging, 2026-10-20):
 *  - terminal /exec and /preview/start return 503 HOST_EXECUTION_DISABLED
 *  - /ws-files read/write/list work normally
 *  - BROWSERBASE_API_KEY is absent (not exercised here — config, not code)
 *
 * T1/T1b — Fix 1: a manifest checkpoint (path → sha256 baseline captured
 *   over the file services when git cannot run) must compare by
 *   re-enumeration: a persisted write reports "changed" naming the file;
 *   a zero-write run reports "unchanged" — never "unknown" for either.
 * T1a — Fix 1 creation path (ported 2026-10-20 from the duplicate Lane B
 *   suite's realization of ART-20261020-008; adapted to this branch's
 *   seams): with /exec 503ing, checkpoint CREATION must fall back too —
 *   the manifest baseline is captured over the file services and
 *   persisted on the checkpoint row (git_sha empty, description under
 *   the manifest-checkpoint:v1: prefix) — never no checkpoint at all.
 * T2 — Fix 1c: a failed re-checkpoint (null) before a later mutating tool
 *   must not erase the threaded baseline (`?? checkpoint`, agent-loop-v2).
 * T3 — Fix 2: for a static workspace, the agent preview path reports the
 *   static preview ready with the /api/preview/<projectId>/ URL and never
 *   calls transport.startPreview.
 * T4 — proof (not a regression; the document route predates Gate 1):
 *   the /api/preview/<projectId>/ route — the URL the Studio panel
 *   loads — serves the persisted Harbor Coffee document. Ported with
 *   T1a from the duplicate suite; the route is untouched by Gate 1, so
 *   this passes before and after — it pins the serving half of the
 *   preview path the panel depends on.
 *
 * No test requires network, a provider, Browserbase, or a staging call.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

import {
  computeWorkspaceChange,
  type WorkspaceChangeProbe,
} from "./workspace-change-producer";
import type { CheckpointInfo, WorkspaceTransport } from "./workspace-transport";
import { handlePreviewStart, handlePreviewStatus } from "./tool-handlers-v2";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

// ─── Module mocks for T1a / T4 (spread-original so the import graphs of
// the suites above survive; only the seams the two ported tests drive are
// replaced) ──
vi.mock("@/lib/missions/mission-repository", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createCheckpoint: vi.fn(async () => ({ id: "ckpt-mock" })),
}));
vi.mock("@/lib/terminal-config", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));
vi.mock("@/lib/terminal-auth", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  auth: vi.fn(),
}));
vi.mock("@/lib/projects/project-repository", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getProject: vi.fn(),
}));
// T4 only: the document route's HTML transform + asset-manifest modules
// pull in parse5, which vite cannot resolve through this worktree's
// symlinked node_modules (the same suites pass in the main checkout).
// The route's own auth → ownership → path → ws-files fetch → response
// path stays real; the transform is stubbed to identity and the manifest
// to a complete single-asset result. Both stubbed modules keep their own
// dedicated suites (static-preview-document.test.ts,
// preview-asset-manifest.test.ts).
vi.mock("@/lib/projects/static-preview-document", () => ({
  prepareStaticPreviewDocument: vi.fn(async (html: string) => ({ html })),
  scanPreviewDocument: vi.fn(() => ({ scripts: [], stylesheets: [], links: [] })),
}));
vi.mock("@/lib/projects/preview-asset-manifest", () => ({
  collectPreviewAssetManifest: vi.fn(async (filePath: string) => ({
    assets: [filePath],
    documentsVisited: 1,
    scriptsScanned: 0,
    durationMs: 0,
    complete: true,
    truncated: false,
    truncationReasons: [],
    readFailures: 0,
    parseFailures: 0,
    timedOut: false,
  })),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";
import { createWorkspaceCheckpoint } from "@/lib/missions/workspace-checkpoint";
import { createCheckpoint } from "@/lib/missions/mission-repository";
import {
  MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX,
  decodeManifestCheckpointDescription,
} from "@/lib/missions/workspace-manifest";
import { GET as previewDocumentGET } from "@/app/api/preview/[projectId]/[[...path]]/route";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";

const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

const SCAFFOLD_HTML =
  "<!doctype html><html><body><h1>Welcome to LiTT</h1><p>Your AI workspace is ready.</p></body></html>";
const HARBOR_HTML =
  "<!doctype html><html><body><h1>Harbor Coffee</h1><p>Fresh roasts by the harbor.</p></body></html>";

/**
 * Faithful reconstruction of the Harbor Coffee index.html persisted by
 * run 0c5b5074 in staging project 6090dad2 (content per
 * ~/workspace/staging-acceptance-47824457-report-2026-10-20.md): hero with
 * tagline, a six-drink menu with prices, an Our Story section, and a
 * footer with address / phone / email / hours. Used only by T4.
 */
const HARBOR_COFFEE_HTML = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>Harbor Coffee</title>',
  "<style>body{font-family:Georgia,serif;margin:0;color:#2b1d16}header{padding:4rem 2rem;text-align:center;background:#f3e7d3}section{padding:2rem}footer{background:#2b1d16;color:#f3e7d3;padding:2rem}</style>",
  "</head><body>",
  "<header><h1>Harbor Coffee</h1>",
  "<p>Handcrafted coffee roasted to order, served in a warm harbor-side sanctuary.</p></header>",
  "<section><h2>Menu</h2><ul>",
  "<li>Espresso — $3.50</li>",
  "<li>Cappuccino — $4.75</li>",
  "<li>Honey Lavender Latte — $5.95</li>",
  "<li>Cold Brew — $4.50</li>",
  "<li>Dark Chocolate Mocha — $5.25</li>",
  "<li>Spiced Chai Latte — $4.95</li>",
  "</ul></section>",
  "<section><h2>Our Story</h2>",
  "<p>Harbor Coffee began as a small roastery on the Seaside waterfront, sourcing beans from family farms and roasting every batch to order.</p></section>",
  "<footer><p>127 Harbor Street, Seaside, OR 97135</p>",
  "<p>(503) 555-0192 · hello@harborcoffee.com</p>",
  "<p>Open daily 7am — 6pm</p></footer>",
  "</body></html>",
].join("\n");

const HOST_EXEC_503 = new Error(
  'exec failed (503): {"code":"HOST_EXECUTION_DISABLED"}',
);

/** A file-services probe over an in-memory workspace; git always 503s. */
function manifestProbe(files: Record<string, string>) {
  return {
    gitStatus: vi.fn(async () => {
      throw HOST_EXEC_503;
    }),
    gitDiff: vi.fn(async () => {
      throw HOST_EXEC_503;
    }),
    listFiles: vi.fn(async (path: string) => {
      if (path !== "." && path !== "") {
        throw new Error(`unexpected list path: ${path}`);
      }
      return {
        entries: Object.keys(files).map((name) => ({ name, type: "file" })),
      };
    }),
    readFile: vi.fn(async (path: string) => ({
      content: files[path] ?? "",
      size: (files[path] ?? "").length,
    })),
  } as unknown as WorkspaceChangeProbe;
}

const MANIFEST_CHECKPOINT = {
  checkpointId: "ckpt-manifest-1",
  label: "Pre-mutation: files.write",
  gitSha: "",
  kind: "manifest",
  manifest: { "index.html": sha256Hex(SCAFFOLD_HTML) },
} as unknown as CheckpointInfo;

describe("Lane B regression — change verification without git (staging shape)", () => {
  it("T1: reports 'changed' naming the written file when git is 503 but a manifest baseline exists", async () => {
    const probe = manifestProbe({ "index.html": HARBOR_HTML });
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
  });

  it("T1b: a zero-write run under the same 503 reports 'unchanged', not 'unknown' (run 32e3a25f control)", async () => {
    const probe = manifestProbe({ "index.html": SCAFFOLD_HTML });
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("unchanged");
    expect(result.files).toEqual([]);
  });

  it("T1c: a manifest checkpoint whose file services are unreachable still reports 'unknown', never a guess", async () => {
    const probe = {
      gitStatus: vi.fn(async () => {
        throw HOST_EXEC_503;
      }),
    } as unknown as WorkspaceChangeProbe;
    const result = await computeWorkspaceChange(probe, MANIFEST_CHECKPOINT);
    expect(result.status).toBe("unknown");
  });

  it("T1a: checkpoint creation falls back to a manifest baseline when the git exec path 503s", async () => {
    vi.mocked(createCheckpoint).mockReset();
    vi.mocked(createCheckpoint).mockResolvedValue({ id: "ckpt-manifest-1" } as never);
    // Terminal double at the fetch level: /exec refuses (the staging
    // shape), /ws-files serves the scaffold workspace. gates12's
    // workspaceFileSurface consumes readFile's `content` as the document
    // string directly, and workspace-manifest.ts hashes that string.
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const u = String(url);
        fetchedUrls.push(u);
        if (u.includes("/internal/workspace/") && u.endsWith("/exec")) {
          return new Response(JSON.stringify({ code: "HOST_EXECUTION_DISABLED" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("/ws-files/read")) {
          const body = JSON.parse(init?.body ?? "{}") as { path?: string };
          const content = body.path === "index.html" ? SCAFFOLD_HTML : "";
          return new Response(
            JSON.stringify({ content, size: content.length }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("/ws-files")) {
          return new Response(
            JSON.stringify({ entries: [{ name: "index.html", type: "file" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    try {
      const result = await createWorkspaceCheckpoint({
        projectId: "6090dad2-0eba-4c6d-892e-0fa9d57adb05",
        userId: "u-test",
        workspaceId: "ws-6090dad2",
        label: "Pre-mutation: files.write",
      });
      // The git exec path was exercised first — and refused.
      expect(fetchedUrls.some((u) => u.endsWith("/exec"))).toBe(true);
      expect(result.checkpointId).toBe("ckpt-manifest-1");
      expect(result.gitSha).toBe("");
      expect(result.kind).toBe("manifest");
      expect(result.manifest).toEqual({ "index.html": sha256Hex(SCAFFOLD_HTML) });
      // The manifest rides the checkpoint record (no migration): the row
      // is inserted with an empty git SHA and the manifest encoded in its
      // description under this branch's manifest-checkpoint:v1: prefix,
      // recoverable through the branch's own decoder (the same decode
      // the approvals route uses to recover the baseline after a pause).
      expect(vi.mocked(createCheckpoint)).toHaveBeenCalledTimes(1);
      const inserted = vi.mocked(createCheckpoint).mock.calls[0]?.[0] as unknown as {
        gitSha: string;
        description?: string;
      };
      expect(inserted.gitSha).toBe("");
      expect(inserted.description?.startsWith(MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX)).toBe(true);
      expect(decodeManifestCheckpointDescription(inserted.description)).toEqual({
        "index.html": sha256Hex(SCAFFOLD_HTML),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Lane B regression — baseline preservation across a failed re-checkpoint (Fix 1c)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Building.",
        toolCalls: [
          { toolId: "files.mkdir", toolCallId: "tc-1", inputs: { path: "site" } },
          {
            toolId: "files.write",
            toolCallId: "tc-2",
            inputs: { projectId: "p-test", path: "site/index.html", content: HARBOR_HTML },
          },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });
  });

  it("T2: a failed checkpoint creation before a later mutating tool must not erase the threaded baseline", async () => {
    let n = 0;
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      mkdir: vi.fn(async () => ({ created: true })),
      writeFile: vi.fn(async () => ({ written: true })),
      readFile: vi.fn(async () => ({ content: HARBOR_HTML, size: HARBOR_HTML.length })),
      gitStatus: vi.fn(async () => ({
        branch: "main",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [{ path: "index.html", status: "M" }],
        untracked: [],
        clean: false,
      })),
      // First mutation gets a valid baseline; every later re-checkpoint
      // fails the way a 503ing createWorkspaceCheckpoint does (null).
      createCheckpointBeforeMutation: vi.fn(async (label: string) => {
        n += 1;
        return n === 1
          ? { checkpointId: "cp-1", label, gitSha: "a".repeat(40) }
          : null;
      }),
    } as unknown as WorkspaceTransport;

    const result = await runAgentLoopV2("Build me a site", transport, {
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
      maxSteps: 5,
    });

    expect(result.toolCalls.every((c) => c.success)).toBe(true);
    // The finale still compares against the threaded baseline…
    expect(result.workspaceChange?.status).toBe("changed");
    expect(result.workspaceChange?.files).toContain("index.html");
    // …and the run's recorded checkpoint is that baseline, not undefined.
    expect(result.checkpoint?.checkpointId).toBe("cp-1");
  });
});

describe("Lane B regression — static preview must not need the dev server (Fix 2)", () => {
  it("T3: preview start for a static workspace reports ready with the static URL and never calls transport.startPreview", async () => {
    const startPreview = vi.fn(async () => {
      throw new Error("Preview start failed (503): HOST_EXECUTION_DISABLED");
    });
    const getPreviewStatus = vi.fn(async () => {
      throw new Error("Preview status failed (503): HOST_EXECUTION_DISABLED");
    });
    const transport = {
      workspaceId: "ws-6090dad2",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "6090dad2-0eba-4c6d-892e-0fa9d57adb05",
      isStaticWorkspace: true,
      startPreview,
      getPreviewStatus,
    } as unknown as WorkspaceTransport;

    const started = await handlePreviewStart({}, transport);
    expect(startPreview).not.toHaveBeenCalled();
    expect(started.success).toBe(true);
    expect(started.status).toBe("ready");
    expect(String(started.previewUrl)).toContain(
      "/api/preview/6090dad2-0eba-4c6d-892e-0fa9d57adb05/",
    );

    const status = await handlePreviewStatus({}, transport);
    expect(getPreviewStatus).not.toHaveBeenCalled();
    expect(status.success).toBe(true);
    expect(status.status).toBe("ready");
    expect(String(status.previewUrl)).toContain("/api/preview/");
  });
});

// ─── T4 — proof: the panel's document route serves the persisted page ──

describe("Lane B proof — the /api/preview document route serves the persisted document", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", "x".repeat(32));
    vi.mocked(auth).mockResolvedValue({ userId: "u-test" } as never);
    vi.mocked(getProject).mockResolvedValue({
      id: "6090dad2-0eba-4c6d-892e-0fa9d57adb05",
      userId: "u-test",
      workspaceId: "ws-6090dad2",
    } as never);
    // The terminal file service serves the persisted Harbor Coffee page —
    // exactly the bytes the approved files.write landed in run 0c5b5074.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ content: HARBOR_COFFEE_HTML, size: HARBOR_COFFEE_HTML.length, encoding: "utf-8" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("T4: GET /api/preview/<projectId>/ returns the Harbor Coffee document (hero, menu with prices, footer)", async () => {
    const res = await previewDocumentGET(
      new Request("https://x.test/api/preview/6090dad2-0eba-4c6d-892e-0fa9d57adb05") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "6090dad2-0eba-4c6d-892e-0fa9d57adb05", path: undefined }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Harbor Coffee");
    expect(body).toContain("Handcrafted coffee roasted to order");
    expect(body).toContain("Honey Lavender Latte");
    expect(body).toContain("$5.95");
    expect(body).toContain("127 Harbor Street, Seaside, OR 97135");
    expect(body).not.toContain("Welcome to LiTT");
  });
});
