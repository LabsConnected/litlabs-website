/**
 * Regression tests for the Windows exec() false-failure defect.
 *
 * Defect: exec() shelled through powershell.exe while every external-tool
 * command string appended `2>&1`. Windows PowerShell converts a native
 * command's stderr into a NativeCommandError when it is redirected that way,
 * so execSync threw and exec() reported exitCode 1 even though the command
 * succeeded and stdout was complete.
 *
 * Symptom: `litt stripe doctor` reported "Stripe auth: Not authenticated" and
 * "Cannot retrieve price" for prices that were live, active and correct.
 *
 * Second-order defect: merging stderr into stdout corrupts JSON.parse() for
 * every caller that parses `--json` output, because any tool banner or hint
 * written to stderr lands in the middle of the parsed payload.
 *
 * These tests use only source-text assertions and a real harmless command —
 * no Stripe, Railway, or network calls, and no secret values.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "../lib/utils.js";
import { checkWebhookEndpoint } from "../lib/production-checks.js";

const SRC_ROOT = resolve(__dirname, "..");

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

describe("exec() stderr handling", () => {
  it("captures stderr separately instead of merging it into stdout", () => {
    const src = readFileSync(join(SRC_ROOT, "lib", "utils.ts"), "utf-8");
    // spawnSync returns status/stdout/stderr without throwing on non-zero exit,
    // so a tool that merely writes to stderr can no longer register as a failure.
    expect(src).toContain("spawnSync");
    expect(src).not.toContain("const stdout = execSync(cmd,");
  });

  it("exposes a combined field for callers that want interleaved output", () => {
    const src = readFileSync(join(SRC_ROOT, "lib", "utils.ts"), "utf-8");
    expect(src).toContain("combined");
  });

  it("reports exitCode 0 for a successful command that writes to stderr", () => {
    // Run from a file rather than `node -e` so no shell quoting is involved —
    // this test must behave identically under powershell.exe and sh.
    const script = join(tmpdir(), `litt-exec-noise-${process.pid}.cjs`);
    writeFileSync(
      script,
      `process.stderr.write("warning: noise");\nprocess.stdout.write(JSON.stringify({ ok: true }));\n`,
    );
    try {
      const r = exec(`node "${script}"`);
      expect(r.exitCode).toBe(0);
      // stdout must stay parseable — the stderr noise must not be interleaved.
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      expect(r.stderr).toContain("warning: noise");
      expect(r.combined).toContain("warning: noise");
    } finally {
      rmSync(script, { force: true });
    }
  });

  it("reports a non-zero exitCode for a genuinely failing command", () => {
    const script = join(tmpdir(), `litt-exec-fail-${process.pid}.cjs`);
    writeFileSync(script, `process.exit(3);\n`);
    try {
      expect(exec(`node "${script}"`).exitCode).toBe(3);
    } finally {
      rmSync(script, { force: true });
    }
  });
});

describe("no command string redirects stderr into stdout", () => {
  it("never passes 2>&1 to exec()", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        // Only flag real command strings handed to exec(), not prose. Both
        // explain.ts's usage banner and utils.ts's own doc comment mention
        // `2>&1` deliberately.
        if (!line.includes("2>&1")) return;
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (trimmed.startsWith("console.log(")) return;
        offenders.push(`${file.slice(SRC_ROOT.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ─── Duplicate webhook endpoint detection ──────────────────────────────

describe("checkWebhookEndpoint", () => {
  const URL = "https://www.litlabs.net/api/stripe/webhook";
  const ALL_EVENTS = [
    "checkout.session.completed",
    "checkout.session.expired",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "charge.refunded",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
  ];

  function stubExec(data: unknown[]) {
    return () => ({
      stdout: JSON.stringify({ object: "list", data }),
      stderr: "",
      combined: "",
      exitCode: 0,
    });
  }

  const endpoint = (over: Record<string, unknown> = {}) => ({
    id: "we_primary",
    url: URL,
    status: "enabled",
    livemode: true,
    enabled_events: ALL_EVENTS,
    ...over,
  });

  it("passes for exactly one enabled endpoint with all events", () => {
    const r = checkWebhookEndpoint(stubExec([endpoint()]));
    expect(r.status).toBe("pass");
  });

  it("fails when two enabled endpoints share the production URL", () => {
    const r = checkWebhookEndpoint(
      stubExec([endpoint(), endpoint({ id: "we_stale" })]),
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("2 enabled endpoints");
    expect(r.fix).toContain("we_stale");
  });

  it("ignores a disabled duplicate", () => {
    const r = checkWebhookEndpoint(
      stubExec([endpoint(), endpoint({ id: "we_stale", status: "disabled" })]),
    );
    expect(r.status).toBe("pass");
  });

  it("does not credit events that live on a different endpoint", () => {
    // The old text-search implementation passed here: it searched the whole
    // list output, so events on the unrelated endpoint satisfied the check.
    const r = checkWebhookEndpoint(
      stubExec([
        endpoint({ enabled_events: ["checkout.session.completed"] }),
        endpoint({ id: "we_other", url: "https://other.example/hook", status: "disabled" }),
      ]),
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("invoice.paid");
  });

  it("fails cleanly on unparseable output instead of reporting not-found", () => {
    const r = checkWebhookEndpoint(() => ({
      stdout: "not json",
      stderr: "",
      combined: "",
      exitCode: 0,
    }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("parse");
  });
});
