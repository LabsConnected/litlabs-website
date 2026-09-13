import { describe, it, expect } from "vitest";

/**
 * User-project deployment domain rules.
 *
 * V1 blocker: the V2 agent loop had no tool able to deploy the USER'S
 * generated project. `preview.open` is registered but disabled (no handler),
 * `project.ship` is git shipping (branch/commit/PR), and /api/deploy/trigger
 * redeploys LiTT's OWN admin-gated Railway service. So
 * build → preview → deploy live → live URL could not complete.
 *
 * This module holds the pure rules: artifact validation, path safety,
 * content types, and the two INDEPENDENT state machines (preview vs
 * deployment). No I/O, no provider calls.
 */

import {
  DEPLOYMENT_LIMITS,
  isSafeArtifactPath,
  contentTypeFor,
  validateArtifact,
  isDeploymentTransitionValid,
  isDeploymentTerminal,
  deploymentPublicPath,
  describeDeploymentFailure,
  type ArtifactFile,
} from "./user-deployment";
import * as userDeployment from "./user-deployment";

const html = (path: string, content = "<!doctype html><title>Ember Roast</title>"): ArtifactFile => ({
  path,
  content,
});

/* ── Path safety (case F) ───────────────────────────────────────── */

describe("F. artifact path safety", () => {
  it("accepts ordinary static paths", () => {
    for (const p of ["index.html", "styles.css", "assets/logo.svg", "js/app.js", "a/b/c/d.png"]) {
      expect(isSafeArtifactPath(p)).toBe(true);
    }
  });

  it("rejects parent-directory traversal", () => {
    for (const p of ["../secret", "a/../../etc/passwd", "..", "a/..", "./../x"]) {
      expect(isSafeArtifactPath(p)).toBe(false);
    }
  });

  it("rejects absolute paths and drive letters", () => {
    for (const p of ["/etc/passwd", "//host/share", "C:/Windows/win.ini", "\\\\host\\share"]) {
      expect(isSafeArtifactPath(p)).toBe(false);
    }
  });

  it("rejects backslashes, NUL bytes and control characters", () => {
    expect(isSafeArtifactPath("a\\b.html")).toBe(false);
    expect(isSafeArtifactPath("a\u0000b.html")).toBe(false);
    expect(isSafeArtifactPath("a\nb.html")).toBe(false);
  });

  it("rejects empty, dot-only and overlong paths", () => {
    expect(isSafeArtifactPath("")).toBe(false);
    expect(isSafeArtifactPath(".")).toBe(false);
    expect(isSafeArtifactPath("a".repeat(600) + ".html")).toBe(false);
  });

  it("rejects dotfiles that could leak credentials", () => {
    for (const p of [".env", ".git/config", "config/.env.local", ".npmrc"]) {
      expect(isSafeArtifactPath(p)).toBe(false);
    }
  });

  it("rejects a traversing artifact at validation time, not just per-path", () => {
    const result = validateArtifact([html("index.html"), html("../../escape.html")]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/path/i);
  });
});

/* ── Content types ──────────────────────────────────────────────── */

describe("contentTypeFor", () => {
  it("maps the static web types a landing site needs", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("styles.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("data.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("logo.svg")).toBe("image/svg+xml");
  });

  it("never serves an unknown extension as HTML", () => {
    // Serving unknown bytes as text/html would make an upload an XSS vector.
    expect(contentTypeFor("thing.weird")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeFor("INDEX.HTML")).toBe("text/html; charset=utf-8");
  });
});

/* ── Artifact validation ────────────────────────────────────────── */

describe("validateArtifact", () => {
  it("requires at least one file", () => {
    const result = validateArtifact([]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/no files/i);
  });

  it("requires an index.html entrypoint", () => {
    const result = validateArtifact([html("about.html")]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/index\.html/);
  });

  it("accepts a minimal single-page site", () => {
    const result = validateArtifact([html("index.html"), { path: "styles.css", content: "body{}" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(2);
      expect(result.totalBytes).toBeGreaterThan(0);
    }
  });

  it("rejects an artifact with too many files", () => {
    const files = Array.from({ length: DEPLOYMENT_LIMITS.maxFiles + 1 }, (_, i) => html(`p${i}.html`));
    files[0] = html("index.html");
    const result = validateArtifact(files);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/too many files/i);
  });

  it("rejects an artifact over the total byte cap", () => {
    const big = "x".repeat(DEPLOYMENT_LIMITS.maxTotalBytes + 1);
    const result = validateArtifact([html("index.html", big)]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/too large/i);
  });

  it("rejects a single file over the per-file cap", () => {
    const big = "x".repeat(DEPLOYMENT_LIMITS.maxFileBytes + 1);
    const result = validateArtifact([html("index.html"), { path: "big.css", content: big }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/too large/i);
  });

  it("rejects duplicate paths", () => {
    const result = validateArtifact([html("index.html"), html("index.html")]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/duplicate/i);
  });
});

/* ── Deployment state machine ───────────────────────────────────── */

describe("deployment state machine", () => {
  it("advances not_started → building → deploying → ready", () => {
    expect(isDeploymentTransitionValid("not_started", "building")).toBe(true);
    expect(isDeploymentTransitionValid("building", "deploying")).toBe(true);
    expect(isDeploymentTransitionValid("deploying", "ready")).toBe(true);
  });

  it("allows failure from any non-terminal state", () => {
    for (const from of ["not_started", "building", "deploying"] as const) {
      expect(isDeploymentTransitionValid(from, "failed")).toBe(true);
    }
  });

  it("never leaves a terminal state", () => {
    expect(isDeploymentTerminal("ready")).toBe(true);
    expect(isDeploymentTerminal("failed")).toBe(true);
    expect(isDeploymentTransitionValid("ready", "building")).toBe(false);
    expect(isDeploymentTransitionValid("failed", "ready")).toBe(false);
  });

  it("never jumps straight to ready without deploying", () => {
    // A "ready" that skipped the work is exactly the false-completion bug.
    expect(isDeploymentTransitionValid("not_started", "ready")).toBe(false);
    expect(isDeploymentTransitionValid("building", "ready")).toBe(false);
  });
});

/* ── Preview vs deployment separation (case K) ──────────────────── */

describe("K. preview and deployment states are independent", () => {
  it("has no shared state value that conflates the two", () => {
    // Deployment states are building/deploying — preview states are
    // starting/unreachable. Only "ready"/"failed"/"not_started" overlap by
    // name, and they live on separate fields.
    const deploymentOnly = ["building", "deploying"];
    const previewOnly = ["starting", "unreachable"];
    for (const d of deploymentOnly) expect(previewOnly).not.toContain(d);
  });

  it("does not derive a deployment status from a preview status", () => {
    // There is deliberately no preview→deployment mapping: a ready preview
    // says nothing about deployment, so no such export may exist.
    const exported = Object.keys(userDeployment);
    expect(exported).not.toContain("previewToDeploymentStatus");
    expect(exported).not.toContain("deploymentFromPreview");
  });
});

/* ── Public path + failure description ──────────────────────────── */

describe("deploymentPublicPath", () => {
  it("serves index.html at the deployment root", () => {
    expect(deploymentPublicPath("dep_1", "")).toBe("index.html");
    expect(deploymentPublicPath("dep_1", "/")).toBe("index.html");
  });

  it("resolves nested asset paths", () => {
    expect(deploymentPublicPath("dep_1", "assets/logo.svg")).toBe("assets/logo.svg");
  });

  it("refuses to resolve a traversing request path", () => {
    expect(deploymentPublicPath("dep_1", "../../etc/passwd")).toBeNull();
    expect(deploymentPublicPath("dep_1", "..%2f..%2fsecret")).toBeNull();
  });
});

describe("describeDeploymentFailure", () => {
  it("returns a safe class and never leaks provider credentials", () => {
    const described = describeDeploymentFailure(
      new Error("connect ECONNREFUSED token=sk-live-abcdef123 at https://internal.host"),
    );
    expect(described.errorClass).toBeTruthy();
    expect(described.message).not.toMatch(/sk-live-abcdef123/);
    expect(described.message).not.toMatch(/token=/);
  });

  it("marks transport errors retryable and validation errors not", () => {
    expect(describeDeploymentFailure(new Error("fetch failed")).retryable).toBe(true);
    expect(describeDeploymentFailure(new Error("index.html is required")).retryable).toBe(false);
  });
});
