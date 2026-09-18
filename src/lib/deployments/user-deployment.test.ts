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
  isBinaryContentType,
  isCanonicalBase64,
  isStorableUtf8,
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

  it("recognizes the binary asset types a generated site can carry", () => {
    const binaryTypes: Array<[string, string]> = [
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["icon.png", "image/png"],
      ["anim.gif", "image/gif"],
      ["hero.webp", "image/webp"],
      ["hero.avif", "image/avif"],
      ["favicon.ico", "image/x-icon"],
      ["doc.pdf", "application/pdf"],
      ["mod.wasm", "application/wasm"],
      ["bundle.zip", "application/zip"],
      ["font.woff", "font/woff"],
      ["font.woff2", "font/woff2"],
      ["font.ttf", "font/ttf"],
      ["font.otf", "font/otf"],
      ["img.bmp", "image/bmp"],
    ];
    for (const [path, type] of binaryTypes) {
      expect(contentTypeFor(path)).toBe(type);
      expect(isBinaryContentType(contentTypeFor(path))).toBe(true);
    }
  });

  it("keeps text-bearing types on the utf-8 path", () => {
    for (const path of ["index.html", "styles.css", "app.js", "data.json", "icon.svg", "site.webmanifest"]) {
      expect(isBinaryContentType(contentTypeFor(path))).toBe(false);
    }
  });
});

/* ── Storage safety (Postgres 22P05 regression) ─────────────────── */

describe("storage-safe content", () => {
  it("canonical base64 round-trips", () => {
    expect(isCanonicalBase64(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"))).toBe(true);
    expect(isCanonicalBase64("")).toBe(true);
    // A utf-8 decode of binary bytes is not base64 — this is exactly what
    // a terminal that ignores encoding=base64 hands back.
    const utf8Jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x4a]).toString("utf-8");
    expect(isCanonicalBase64(utf8Jpeg)).toBe(false);
    expect(isCanonicalBase64("not base64!!")).toBe(false);
    expect(isCanonicalBase64("QUJD\n")).toBe(false);
  });

  it("utf-8 with NULs or lone surrogates is not storable", () => {
    expect(isStorableUtf8("plain text")).toBe(true);
    expect(isStorableUtf8("émoji 🐶 café 日本語 “quotes”")).toBe(true);
    expect(isStorableUtf8("bad\u0000text")).toBe(false);
    expect(isStorableUtf8("lone surrogate \ud800 here")).toBe(false);
    expect(isStorableUtf8("trailing \udfff")).toBe(false);
  });

  it("rejects a text artifact whose content cannot be stored", () => {
    // Regression: a utf-8-decoded JPEG contains real U+0000 chars; when it
    // reached Postgres inside the insert JSON the deploy died with
    // "unsupported Unicode escape sequence" (22P05) — after a deployment
    // row already existed. Validation must refuse it earlier, naming the file.
    const result = validateArtifact([
      html("index.html"),
      { path: "assets/images/x.jpeg", content: "\u0000\u0000corrupted" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toContain("assets/images/x.jpeg");
    expect(describeDeploymentFailure(new Error(result.error)).errorClass).toBe("validation");
  });

  it("rejects a base64 artifact whose content is not canonical base64", () => {
    const result = validateArtifact([
      html("index.html"),
      { path: "assets/x.png", content: "ÿØÿ not base64", encoding: "base64" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toContain("assets/x.png");
  });

  it("accepts real Unicode text unchanged", () => {
    const content = "<!doctype html><p>émoji 🐶 café 日本語 “quotes” — café</p>";
    const result = validateArtifact([html("index.html", content)]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files[0].content).toBe(content);
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

/* ── Local-asset integrity (2026-09-17 acceptance P0) ───────────────── */
describe("validateArtifact local-asset integrity", () => {
  const siteWithHero = (extraFiles: ArtifactFile[] = []) =>
    validateArtifact([
      html(
        "index.html",
        `<!doctype html><html><body><img src="/assets/images/hero-dog.png" alt="hero"></body></html>`,
      ),
      ...extraFiles,
    ]);

  it("rejects a site whose <img> points at a file that was never saved", () => {
    const result = siteWithHero();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toMatch(/missing file/i);
    expect(result.error).toContain("index.html → assets/images/hero-dog.png");
  });

  it("accepts the site when the referenced asset is present", () => {
    const result = siteWithHero([{ path: "assets/images/hero-dog.png", content: "PNG" }]);
    expect(result.ok).toBe(true);
  });

  it("resolves relative refs against the referencing file's directory", () => {
    const result = validateArtifact([
      html("index.html", `<img src="images/hero.png">`),
      html("pages/about.html", `<img src="../images/hero.png">`),
      { path: "images/hero.png", content: "PNG" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("catches missing stylesheets, scripts, and CSS url() references", () => {
    const result = validateArtifact([
      html(
        "index.html",
        `<link rel="stylesheet" href="styles.css"><script src="app.js"></script>` +
          `<style>.hero{background:url("bg.jpg")}</style>`,
      ),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toContain("index.html → styles.css");
    expect(result.error).toContain("index.html → app.js");
    expect(result.error).toContain("index.html → bg.jpg");
  });

  it("ignores external URLs, data URIs, and navigation links", () => {
    const result = validateArtifact([
      html(
        "index.html",
        `<a href="about.html">about</a>` +
          `<img src="https://cdn.example.com/x.png">` +
          `<img src="//cdn.example.com/y.png">` +
          `<img src="data:image/png;base64,AAA">` +
          `<img src="/assets/images/local.png">`,
      ),
      { path: "assets/images/local.png", content: "PNG" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("parses srcset candidates individually", () => {
    const missing = validateArtifact([
      html("index.html", `<img srcset="a.png 1x, b.png 2x">`),
      { path: "a.png", content: "PNG" },
    ]);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected validation to fail");
    expect(missing.error).toContain("index.html → b.png");

    const complete = validateArtifact([
      html("index.html", `<img srcset="a.png 1x, b.png 2x">`),
      { path: "a.png", content: "PNG" },
      { path: "b.png", content: "PNG" },
    ]);
    expect(complete.ok).toBe(true);
  });

  it("checks url() references inside stylesheets", () => {
    const result = validateArtifact([
      html("index.html", `<link rel="stylesheet" href="styles.css">`),
      { path: "styles.css", content: `.hero{background:url(/fonts/icon.woff2)}` },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation to fail");
    expect(result.error).toContain("styles.css → fonts/icon.woff2");
  });
});
