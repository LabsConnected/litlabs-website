// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Repair R5-B — the verified-revision publish gate.
 *
 * Invariant: a published artifact must correspond to the EXACT
 * workspace revision that passed the required checks. These tests pin
 * the pure decision logic (evaluatePublishGate / selectVerifiedRevision)
 * and the revision identity (computeWorkspaceRevision) against an
 * in-memory file surface:
 *
 *   build+verify → publish at the same revision        = allowed
 *   build+verify → edit → publish without reverify      = DENIED (stale)
 *   build+verify → edit → reverify → publish            = allowed
 *   second edit after reverify                          = DENIED again
 *   concurrent edit after verification                  = DENIED (the
 *     revision moved; the gate cannot tell "concurrent" from "later" —
 *     both are simply not-the-verified-revision)
 *   no verified record at all                           = DENIED
 *   workspace unreadable at publish time                = DENIED
 *   skipped/failed verification (no ok record)          = DENIED
 *
 * Granularity note (brief scenario (c)): revision identity is
 * WHOLE-WORKSPACE. Quality evidence is stage-based over the project,
 * not per-file, so an edit to ANY file invalidates the record for
 * publish purposes — there is no honest per-file subset to preserve.
 * The "unrelated file" test below pins exactly that behavior.
 */

import {
  evaluatePublishGate,
  isDeployToolId,
  selectVerifiedRevision,
  sessionHasVerificationEvidence,
  type SettledRunVerification,
} from "./verified-revision";
import { computeWorkspaceRevision } from "@/lib/litt-intelligence/workspace-change-producer";
import {
  enumerateWorkspaceManifest,
  manifestDigest,
  sha256Hex,
} from "@/lib/missions/workspace-manifest";
import type { QualityLoopSnapshot } from "@/lib/litt-intelligence/quality-loop-flow";

function fileProbe(files: Record<string, string>) {
  return {
    gitStatus: async () => {
      throw new Error("git unavailable in this probe");
    },
    listFiles: async (path: string) => {
      if (path !== "." && path !== "") throw new Error(`unexpected listFiles path ${path}`);
      return { entries: Object.keys(files).map((name) => ({ name, type: "file" as const })) };
    },
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`readFile: no such file ${path}`);
      return { content, size: content.length };
    },
  };
}

const V1_FILES = {
  "index.html": "<html><body>Harbor Coffee</body></html>",
  "styles.css": "body { color: #333; }",
};
const V2_FILES = {
  ...V1_FILES,
  "index.html": "<html><body>Harbor Coffee — Grand Haven's Harbor Roast</body></html>",
};

describe("computeWorkspaceRevision", () => {
  it("is stable for identical content and changes when ANY file changes", async () => {
    const rev1 = await computeWorkspaceRevision(fileProbe(V1_FILES));
    const rev1Again = await computeWorkspaceRevision(fileProbe({ ...V1_FILES }));
    const rev2 = await computeWorkspaceRevision(fileProbe(V2_FILES));
    expect(rev1).toMatch(/^manifest:/);
    expect(rev1Again).toBe(rev1);
    expect(rev2).not.toBe(rev1);
  });

  it("changes when a file is added or removed", async () => {
    const rev1 = await computeWorkspaceRevision(fileProbe(V1_FILES));
    const added = await computeWorkspaceRevision(
      fileProbe({ ...V1_FILES, "menu.html": "<html>menu</html>" }),
    );
    const removed = await computeWorkspaceRevision(
      fileProbe({ "index.html": V1_FILES["index.html"] }),
    );
    expect(added).not.toBe(rev1);
    expect(removed).not.toBe(rev1);
  });

  it("returns null when the workspace cannot be read and no git fallback exists", async () => {
    const broken = {
      gitStatus: async () => {
        throw new Error("no git");
      },
      listFiles: async () => {
        throw new Error("file services down");
      },
      readFile: async () => {
        throw new Error("file services down");
      },
    };
    expect(await computeWorkspaceRevision(broken)).toBeNull();
    expect(await computeWorkspaceRevision(null)).toBeNull();
    expect(await computeWorkspaceRevision(null, "abc123")).toBe("git:abc123");
  });

  it("the digest it embeds is the manifest digest of the same content", async () => {
    const probe = fileProbe(V1_FILES);
    const rev = await computeWorkspaceRevision(probe);
    const manifest = await enumerateWorkspaceManifest({
      listFiles: probe.listFiles,
      readFile: probe.readFile,
    });
    expect(rev).toBe(`manifest:${manifestDigest(manifest!)}`);
    // And the manifest itself maps each path to its content hash.
    expect(manifest).toEqual({
      "index.html": sha256Hex(V1_FILES["index.html"]),
      "styles.css": sha256Hex(V1_FILES["styles.css"]),
    });
  });
});

describe("selectVerifiedRevision", () => {
  const run = (over: Partial<SettledRunVerification>): SettledRunVerification => ({
    runId: "run-x",
    verdictOk: true,
    verifiedRevision: "manifest:aaa",
    ...over,
  });

  it("picks the NEWEST settled run with an ok verdict and a recorded revision", () => {
    const picked = selectVerifiedRevision([
      run({ runId: "run-new", verifiedRevision: "manifest:bbb" }),
      run({ runId: "run-old", verifiedRevision: "manifest:aaa" }),
    ]);
    expect(picked).toEqual({ revision: "manifest:bbb", runId: "run-new" });
  });

  it("skips runs whose verdict was not ok and runs with no recorded revision", () => {
    const picked = selectVerifiedRevision([
      run({ runId: "run-failed", verdictOk: false }),
      run({ runId: "run-unrecorded", verifiedRevision: null }),
      run({ runId: "run-good", verifiedRevision: "manifest:aaa" }),
    ]);
    expect(picked).toEqual({ revision: "manifest:aaa", runId: "run-good" });
  });

  it("returns null when nothing qualifies — skipped/failed verification proves nothing", () => {
    expect(selectVerifiedRevision([])).toBeNull();
    expect(selectVerifiedRevision([run({ verdictOk: false })])).toBeNull();
    expect(selectVerifiedRevision([run({ verifiedRevision: null })])).toBeNull();
  });
});

describe("evaluatePublishGate — the R5-B scenario matrix", () => {
  it("build+verify → publish at the SAME revision is allowed", async () => {
    const rev = await computeWorkspaceRevision(fileProbe(V1_FILES));
    const decision = evaluatePublishGate({
      record: { revision: rev!, runId: "run-build" },
      currentRevision: rev,
    });
    expect(decision.allowed).toBe(true);
  });

  it("build+verify → EDIT → publish without reverify is DENIED as stale", async () => {
    const verifiedRev = await computeWorkspaceRevision(fileProbe(V1_FILES));
    const currentRev = await computeWorkspaceRevision(fileProbe(V2_FILES));
    const decision = evaluatePublishGate({
      record: { revision: verifiedRev!, runId: "run-build" },
      currentRevision: currentRev,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.code).toBe("stale_revision");
    expect(decision.reason).toContain("changed after it was verified");
  });

  it("build+verify → edit → REVERIFY → publish is allowed", async () => {
    const reverifyRev = await computeWorkspaceRevision(fileProbe(V2_FILES));
    const currentRev = await computeWorkspaceRevision(fileProbe({ ...V2_FILES }));
    const decision = evaluatePublishGate({
      record: { revision: reverifyRev!, runId: "run-edit" },
      currentRevision: currentRev,
    });
    expect(decision.allowed).toBe(true);
  });

  it("a SECOND edit after reverify invalidates again", async () => {
    const reverifyRev = await computeWorkspaceRevision(fileProbe(V2_FILES));
    const v3 = { ...V2_FILES, "styles.css": "body { color: #000; }" };
    const currentRev = await computeWorkspaceRevision(fileProbe(v3));
    const decision = evaluatePublishGate({
      record: { revision: reverifyRev!, runId: "run-edit" },
      currentRevision: currentRev,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.code).toBe("stale_revision");
  });

  it("an edit to an UNRELATED file still invalidates (whole-workspace granularity)", async () => {
    // Quality evidence is stage-based over the whole project — the
    // build/test/preview stages do not certify per-file subsets, so
    // there is no honest way to say "styles.css wasn't covered, the
    // rest still is". Whole-revision invalidation is the truth.
    const verifiedRev = await computeWorkspaceRevision(fileProbe(V1_FILES));
    const edited = { ...V1_FILES, "styles.css": "body { color: rebeccapurple; }" };
    const currentRev = await computeWorkspaceRevision(fileProbe(edited));
    const decision = evaluatePublishGate({
      record: { revision: verifiedRev!, runId: "run-build" },
      currentRevision: currentRev,
    });
    expect(decision.allowed).toBe(false);
  });

  it("no verified record → DENIED (never fabricate a pass)", () => {
    const decision = evaluatePublishGate({ record: null, currentRevision: "manifest:aaa" });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.code).toBe("no_verified_revision");
  });

  it("current revision unknowable → DENIED (fail closed)", () => {
    const decision = evaluatePublishGate({
      record: { revision: "manifest:aaa", runId: "run-build" },
      currentRevision: null,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.code).toBe("current_revision_unknown");
  });

  it("a git-scheme record never matches a manifest-scheme current revision", () => {
    const decision = evaluatePublishGate({
      record: { revision: "git:abc123", runId: "run-build" },
      currentRevision: "manifest:abc123",
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("sessionHasVerificationEvidence — the single-run deploy path", () => {
  const snapshot = (over: Partial<QualityLoopSnapshot>): QualityLoopSnapshot =>
    ({
      state: {
        stages: {
          build: { status: "pending", evidence: [], updatedAt: "" },
        },
      },
      userRequest: "build my site and publish it",
      inspectionRan: false,
      critiqueFailed: false,
      observations: [],
      ...over,
    }) as QualityLoopSnapshot;

  it("an empty session does NOT qualify (publish-only run)", () => {
    expect(sessionHasVerificationEvidence(snapshot({}))).toBe(false);
    expect(sessionHasVerificationEvidence(null)).toBe(false);
    expect(sessionHasVerificationEvidence(undefined)).toBe(false);
  });

  it("recorded BUILD evidence qualifies", () => {
    const snap = snapshot({});
    (snap.state.stages as Record<string, { evidence: unknown[] }>).build.evidence = [
      { kind: "tool_success", summary: "files.write", at: "" },
    ];
    expect(sessionHasVerificationEvidence(snap)).toBe(true);
  });

  it("a recorded successful mutation qualifies", () => {
    expect(sessionHasVerificationEvidence(snapshot({ mutationSeen: true }))).toBe(true);
  });
});

describe("isDeployToolId", () => {
  it("covers the deploy tool and both deploy station actions, nothing else", () => {
    expect(isDeployToolId("project.deploy")).toBe(true);
    expect(isDeployToolId("deploy.production")).toBe(true);
    expect(isDeployToolId("deploy.preview")).toBe(true);
    expect(isDeployToolId("files.write")).toBe(false);
    expect(isDeployToolId("project.preview")).toBe(false);
    expect(isDeployToolId(null)).toBe(false);
    expect(isDeployToolId(undefined)).toBe(false);
  });
});
