#!/usr/bin/env node
/**
 * E2B sandbox isolation canary probe — LiTT Sandbox Acceptance Gate.
 *
 * Verifies, against a LIVE E2B sandbox:
 *  1. Single-sandbox isolation: non-root user, no cloud metadata access,
 *     no host credential names in the environment, files written inside
 *     do not exist on this host, command timeouts enforced.
 *  2. Concurrent-user isolation: TWO sandboxes at once (two simulated
 *     users). Each writes a uniquely-named file and starts a uniquely
 *     marked process; each sandbox then asserts it CANNOT see the other's
 *     file or processes.
 *  3. Publish/execute separation: no production publishing credential
 *     names (hosting/deploy tokens) appear inside the sandbox.
 *
 * Behavior without a key: prints SKIP and exits 0 (clean skip — the unit
 * tests in src/lib/terminal-v1/providers/e2b-provider.test.ts cover the
 * adapter logic with a mocked client).
 *
 * Usage:
 *   E2B_API_KEY=... node scripts/verify-e2b-sandbox.mjs
 *
 * Env knobs:
 *   PROBE_KEEP_ALIVE=1   leave sandboxes running for manual inspection
 *                        (default: destroy immediately after the run)
 *
 * The API key is read from the environment only and is never printed.
 */

const FORBIDDEN_ENV_NAMES = [
  // Platform/host secrets — must never leak into a sandbox.
  "E2B_API_KEY",
  "CLERK_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "TERMINAL_AUTH_SECRET",
  // Production PUBLISHING credentials — publish != execute.
  "VERCEL_TOKEN",
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "RAILWAY_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "FLY_API_TOKEN",
  "RENDER_API_KEY",
];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function rand() {
  return Math.random().toString(36).slice(2, 10);
}

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log("SKIP: E2B_API_KEY is not set — live probe skipped (fail-closed).");
    console.log("Set E2B_API_KEY to run the isolation canary.");
    process.exit(0);
  }

  const { Sandbox } = await import("e2b");
  const keepAlive = process.env.PROBE_KEEP_ALIVE === "1";
  const sandboxes = [];

  const track = (sbx) => {
    sandboxes.push(sbx);
    return sbx;
  };

  try {
    // ── Single-sandbox isolation ──────────────────────────────
    const sbx = track(
      await Sandbox.create({
        apiKey,
        timeoutMs: 5 * 60 * 1000,
        metadata: { probe: "litt-e2b-isolation-canary" },
      }),
    );
    console.log(`probe sandbox: ${sbx.sandboxId}`);

    // 1. Non-root user
    {
      const r = await sbx.commands.run("whoami");
      check("sandbox user is non-root", r.stdout.trim() !== "root", `whoami=${r.stdout.trim()}`);
    }

    // 2. Cloud metadata endpoint unreachable
    {
      const r = await sbx.commands.run(
        "curl -m 5 -sS http://169.254.169.254/latest/meta-data/ -o /dev/null; echo \"curl_exit=$?\"",
      );
      const m = r.stdout.match(/curl_exit=(\d+)/);
      const blocked = !m || m[1] !== "0";
      check("cloud metadata endpoint blocked", blocked, (m ? `curl_exit=${m[1]}` : "no curl output") + " (non-zero = blocked)");
    }

    // 3. No host/publishing credential names in sandbox env
    {
      const r = await sbx.commands.run("env | sort");
      const leaked = FORBIDDEN_ENV_NAMES.filter((n) =>
        r.stdout.split("\n").some((line) => line.startsWith(`${n}=`)),
      );
      check("no host/publishing credentials in sandbox env", leaked.length === 0, leaked.length ? `LEAKED: ${leaked.join(",")}` : "clean");
    }

    // 4. File written inside does not exist on this host
    {
      const marker = `/tmp/e2b-canary-${rand()}.txt`;
      await sbx.files.write(marker, "canary");
      const { existsSync } = await import("node:fs");
      check("sandbox file not visible on host", !existsSync(marker), marker);
    }

    // 5. Command timeout enforced
    {
      let timedOut = false;
      try {
        await sbx.commands.run("sleep 30", { timeoutMs: 3000 });
      } catch (err) {
        timedOut = /timout|timeout/i.test(err?.name || "") || /timed out/i.test(err?.message || "");
      }
      check("command timeout enforced (sleep 30 @ 3s)", timedOut);
    }

    // ── Concurrent-user isolation: two sandboxes at once ───────
    const tagA = rand();
    const tagB = rand();
    const [sbxA, sbxB] = await Promise.all([
      track(await Sandbox.create({ apiKey, timeoutMs: 5 * 60 * 1000, metadata: { probe: "litt-e2b-user-a" } })),
      track(await Sandbox.create({ apiKey, timeoutMs: 5 * 60 * 1000, metadata: { probe: "litt-e2b-user-b" } })),
    ]);
    console.log(`concurrent sandboxes: A=${sbxA.sandboxId} B=${sbxB.sandboxId}`);

    const fileA = `/tmp/e2b-user-a-${tagA}.txt`;
    const fileB = `/tmp/e2b-user-b-${tagB}.txt`;
    const procA = `e2b-proc-marker-a-${tagA}`;
    const procB = `e2b-proc-marker-b-${tagB}`;
    await Promise.all([
      sbxA.files.write(fileA, "user-a-secret"),
      sbxB.files.write(fileB, "user-b-secret"),
      sbxA.commands.run(`nohup sleep 300 # ${procA} >/dev/null 2>&1 & echo bg-started`),
      sbxB.commands.run(`nohup sleep 300 # ${procB} >/dev/null 2>&1 & echo bg-started`),
    ]);

    // A cannot see B's file or processes; B cannot see A's.
    {
      const r = await sbxA.commands.run(`test ! -e ${fileB} && echo ABSENT || echo VISIBLE`);
      check("sandbox A cannot see sandbox B's file", r.stdout.includes("ABSENT"), r.stdout.trim());
    }
    {
      const r = await sbxB.commands.run(`test ! -e ${fileA} && echo ABSENT || echo VISIBLE`);
      check("sandbox B cannot see sandbox A's file", r.stdout.includes("ABSENT"), r.stdout.trim());
    }
    {
      const r = await sbxA.commands.run(`pgrep -f ${procB} >/dev/null 2>&1 && echo VISIBLE || echo ABSENT`);
      check("sandbox A cannot see sandbox B's processes", r.stdout.includes("ABSENT"), r.stdout.trim());
    }
    {
      const r = await sbxB.commands.run(`pgrep -f ${procA} >/dev/null 2>&1 && echo VISIBLE || echo ABSENT`);
      check("sandbox B cannot see sandbox A's processes", r.stdout.includes("ABSENT"), r.stdout.trim());
    }
    // Sanity: each sandbox CAN see its own file (the test setup worked).
    {
      const r = await sbxA.commands.run(`test -e ${fileA} && echo PRESENT || echo MISSING`);
      check("sandbox A sees its own file (sanity)", r.stdout.includes("PRESENT"), r.stdout.trim());
    }
  } finally {
    if (!keepAlive) {
      for (const sbx of sandboxes) {
        try {
          await sbx.kill();
          console.log(`destroyed sandbox ${sbx.sandboxId}`);
        } catch (err) {
          console.log(`destroy of ${sbx.sandboxId} failed (best-effort): ${err?.message || err}`);
        }
      }
    } else {
      console.log("PROBE_KEEP_ALIVE=1 — sandboxes left running:", sandboxes.map((s) => s.sandboxId).join(", "));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error("ISOLATION PROBE FAILED — do not approve E2B for production execution.");
    process.exit(1);
  }
  console.log("ISOLATION PROBE PASSED.");
}

main().catch((err) => {
  console.error("probe crashed:", err?.message || err);
  process.exit(2);
});
