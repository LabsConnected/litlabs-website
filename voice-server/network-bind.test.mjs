import { test } from "node:test";
import assert from "node:assert/strict";
import { isRailwayRuntime, parseNetworkFlags, resolveBindHost } from "./network-bind.mjs";

const NO_TAILSCALE = () => null;
const FAKE_TAILSCALE = () => "100.107.123.73";

// --- isRailwayRuntime ---

test("isRailwayRuntime: false with no markers", () => {
  assert.equal(isRailwayRuntime({}), false);
});

test("isRailwayRuntime: true on RAILWAY_ENVIRONMENT_ID (covers preview/staging)", () => {
  assert.equal(isRailwayRuntime({ RAILWAY_ENVIRONMENT_ID: "env_abc" }), true);
});

test("isRailwayRuntime: true on RAILWAY_SERVICE_ID", () => {
  assert.equal(isRailwayRuntime({ RAILWAY_SERVICE_ID: "svc_abc" }), true);
});

test("isRailwayRuntime: true on RAILWAY_PROJECT_ID", () => {
  assert.equal(isRailwayRuntime({ RAILWAY_PROJECT_ID: "proj_abc" }), true);
});

test("isRailwayRuntime: NOT satisfied by RAILWAY_ENVIRONMENT_NAME alone", () => {
  assert.equal(isRailwayRuntime({ RAILWAY_ENVIRONMENT_NAME: "production" }), false);
});

// --- parseNetworkFlags ---

test("parseNetworkFlags: detects --lan and --tailscale independently", () => {
  assert.deepEqual(parseNetworkFlags(["--lan"]), { lan: true, tailscale: false });
  assert.deepEqual(parseNetworkFlags(["--tailscale"]), { lan: false, tailscale: true });
  assert.deepEqual(parseNetworkFlags([]), { lan: false, tailscale: false });
});

// --- resolveBindHost: LOCAL ---

test("resolveBindHost: defaults to 127.0.0.1 locally", () => {
  const r = resolveBindHost({ argv: [], env: {}, findTailscaleAddress: NO_TAILSCALE });
  assert.deepEqual(r, { host: "127.0.0.1", reason: "default-local", isRailway: false });
});

test("resolveBindHost: --lan gives explicit 0.0.0.0", () => {
  const r = resolveBindHost({ argv: ["--lan"], env: {}, findTailscaleAddress: NO_TAILSCALE });
  assert.deepEqual(r, { host: "0.0.0.0", reason: "lan", isRailway: false });
});

test("resolveBindHost: --tailscale binds to the detected address", () => {
  const r = resolveBindHost({
    argv: ["--tailscale"],
    env: {},
    findTailscaleAddress: FAKE_TAILSCALE,
  });
  assert.deepEqual(r, { host: "100.107.123.73", reason: "tailscale", isRailway: false });
});

test("resolveBindHost: --tailscale with no interface throws, never falls back", () => {
  assert.throws(
    () => resolveBindHost({ argv: ["--tailscale"], env: {}, findTailscaleAddress: NO_TAILSCALE }),
    /no Tailscale interface\/IP was found/,
  );
});

test("resolveBindHost: explicit HOST env honored with no flags", () => {
  const r = resolveBindHost({
    argv: [],
    env: { HOST: "10.0.0.5" },
    findTailscaleAddress: NO_TAILSCALE,
  });
  assert.deepEqual(r, { host: "10.0.0.5", reason: "explicit-host", isRailway: false });
});

test("resolveBindHost: no flag combination accidentally binds 0.0.0.0 or ::", () => {
  const cases = [
    { argv: [], env: {} },
    { argv: ["--watch"], env: {} },
    { argv: [], env: { NODE_ENV: "production" } },
  ];
  for (const c of cases) {
    const r = resolveBindHost({ ...c, findTailscaleAddress: NO_TAILSCALE });
    assert.notEqual(r.host, "0.0.0.0");
    assert.notEqual(r.host, "::");
  }
});

// --- resolveBindHost: RAILWAY ---

test("resolveBindHost: Railway markers force 0.0.0.0", () => {
  const r = resolveBindHost({
    argv: [],
    env: { RAILWAY_ENVIRONMENT_ID: "env_abc" },
    findTailscaleAddress: NO_TAILSCALE,
  });
  assert.deepEqual(r, { host: "0.0.0.0", reason: "railway", isRailway: true });
});

test("resolveBindHost: Railway preview/staging (name != production, ID present) still binds 0.0.0.0", () => {
  const r = resolveBindHost({
    argv: [],
    env: { RAILWAY_ENVIRONMENT_ID: "env_preview", RAILWAY_ENVIRONMENT_NAME: "pr-217-preview" },
    findTailscaleAddress: NO_TAILSCALE,
  });
  assert.equal(r.host, "0.0.0.0");
  assert.equal(r.isRailway, true);
});

test("resolveBindHost: Railway takes precedence over --tailscale/--lan", () => {
  const r = resolveBindHost({
    argv: ["--tailscale"],
    env: { RAILWAY_SERVICE_ID: "svc_abc" },
    findTailscaleAddress: NO_TAILSCALE, // must never be called — Railway wins first
  });
  assert.deepEqual(r, { host: "0.0.0.0", reason: "railway", isRailway: true });
});

test("resolveBindHost: Railway never resolves to 127.0.0.1", () => {
  const r = resolveBindHost({
    argv: [],
    env: { RAILWAY_PROJECT_ID: "proj_abc" },
    findTailscaleAddress: NO_TAILSCALE,
  });
  assert.notEqual(r.host, "127.0.0.1");
});
