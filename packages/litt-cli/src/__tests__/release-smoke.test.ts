/**
 * Release smoke test — catches the missing-externals class of failure
 * that broke the first standalone release (ERR_MODULE_NOT_FOUND:
 * yoga-layout). bundle.mjs intentionally keeps native/WASM/dynamic
 * deps external; a standalone artifact only runs if `pnpm deploy`
 * ships them. This test deploys to a temp dir and runs the bundle
 * from there — with no development-worktree node_modules anywhere
 * in the resolution path.
 *
 * Heavy (pnpm deploy + real node spawn). Runs in the full suite; the
 * prod path it's protecting is the installed launcher.
 */

import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("release smoke: standalone deploy runs without worktree node_modules", () => {
  it("deployed dist boots and all externals resolve", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "litt-release-"));
    try {
      execSync(
        `pnpm --filter=@litlabs1/litt-cli deploy --legacy --prod "${tmp.replace(/\\/g, "/")}"`,
        { cwd: pkgRoot, stdio: "pipe", timeout: 180_000 },
      );
      const entry = path.join(tmp, "dist", "index.js");
      expect(existsSync(entry), "deployed dist/index.js missing").toBe(true);

      // Boot the real bundle with NODE_PATH stripped — proves no hidden
      // dependency on the workspace's hoisted node_modules.
      const out = execFileSync("node", [entry, "--version"], {
        cwd: tmp,
        env: { ...process.env, NODE_PATH: "" },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(out).toMatch(/litt \d+\.\d+\.\d+/);

      // Every esbuild external must resolve inside the deployed package
      // (or be a declared-optional ws fallback).
      const OPTIONAL_WS = new Set(["bufferutil", "utf-8-validate"]);
      const externals = ["yoga-layout", "@napi-rs/keyring", "bufferutil", "utf-8-validate"];
      for (const ext of externals) {
        const resolved = existsSync(path.join(tmp, "node_modules", ext));
        expect(resolved || OPTIONAL_WS.has(ext), `external ${ext} missing from deployed release`).toBe(true);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 240_000);
});
