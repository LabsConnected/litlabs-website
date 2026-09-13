import { describe, expect, it } from "vitest";
import {
  findTailscaleAddress,
  isRailwayRuntime,
  parseNetworkFlags,
  resolveBindHost,
} from "../network-bind";

const NO_TAILSCALE = () => null;
const FAKE_TAILSCALE = () => "100.107.123.73";

describe("isRailwayRuntime", () => {
  it("is false with no Railway markers", () => {
    expect(isRailwayRuntime({})).toBe(false);
  });

  it("is true when RAILWAY_ENVIRONMENT_ID is present (covers preview/staging, not just prod)", () => {
    expect(isRailwayRuntime({ RAILWAY_ENVIRONMENT_ID: "env_abc123" })).toBe(true);
  });

  it("is true when RAILWAY_SERVICE_ID is present", () => {
    expect(isRailwayRuntime({ RAILWAY_SERVICE_ID: "svc_abc123" })).toBe(true);
  });

  it("is true when RAILWAY_PROJECT_ID is present", () => {
    expect(isRailwayRuntime({ RAILWAY_PROJECT_ID: "proj_abc123" })).toBe(true);
  });

  it("does NOT depend on RAILWAY_ENVIRONMENT_NAME alone", () => {
    // A stale/renamed environment name with none of the ID markers must
    // not be treated as Railway — this guards against ever regressing to
    // a name-based check that misses preview/staging deploys.
    expect(isRailwayRuntime({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(false);
  });
});

describe("parseNetworkFlags", () => {
  it("detects --lan", () => {
    expect(parseNetworkFlags(["--lan"])).toEqual({ lan: true, tailscale: false });
  });

  it("detects --tailscale", () => {
    expect(parseNetworkFlags(["--tailscale"])).toEqual({ lan: false, tailscale: true });
  });

  it("defaults both false with no flags", () => {
    expect(parseNetworkFlags([])).toEqual({ lan: false, tailscale: false });
  });

  it("ignores unrelated flags", () => {
    expect(parseNetworkFlags(["--turbo", "-p", "3001"])).toEqual({ lan: false, tailscale: false });
  });
});

describe("resolveBindHost — LOCAL", () => {
  it("defaults to 127.0.0.1 with no flags, no env, no Railway markers", () => {
    const result = resolveBindHost({ argv: [], env: {}, findTailscaleAddress: NO_TAILSCALE });
    expect(result).toEqual({ host: "127.0.0.1", reason: "default-local", isRailway: false });
  });

  it("--lan enables intentional 0.0.0.0 exposure", () => {
    const result = resolveBindHost({
      argv: ["--lan"],
      env: {},
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(result).toEqual({ host: "0.0.0.0", reason: "lan", isRailway: false });
  });

  it("--tailscale binds to the detected Tailscale address", () => {
    const result = resolveBindHost({
      argv: ["--tailscale"],
      env: {},
      findTailscaleAddress: FAKE_TAILSCALE,
    });
    expect(result).toEqual({ host: "100.107.123.73", reason: "tailscale", isRailway: false });
  });

  it("--tailscale with no interface found throws rather than falling back", () => {
    expect(() =>
      resolveBindHost({ argv: ["--tailscale"], env: {}, findTailscaleAddress: NO_TAILSCALE }),
    ).toThrow(/no Tailscale interface\/IP was found/);
  });

  it("an explicit HOST env var is honored when no flags are set", () => {
    const result = resolveBindHost({
      argv: [],
      env: { HOST: "10.0.0.5" },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(result).toEqual({ host: "10.0.0.5", reason: "explicit-host", isRailway: false });
  });

  it("no flag ever silently produces 0.0.0.0", () => {
    // Sweep every non-Railway, non-flag input shape and assert none of
    // them resolve to a wide bind.
    const cases: Array<{ argv: string[]; env: NodeJS.ProcessEnv }> = [
      { argv: [], env: {} },
      { argv: ["--turbo"], env: {} },
      { argv: [], env: { NODE_ENV: "production" } },
    ];
    for (const c of cases) {
      const result = resolveBindHost({ ...c, findTailscaleAddress: NO_TAILSCALE });
      expect(result.host).not.toBe("0.0.0.0");
      expect(result.host).not.toBe("::");
    }
  });
});

describe("resolveBindHost — RAILWAY", () => {
  it("Railway markers force 0.0.0.0 regardless of flags", () => {
    const result = resolveBindHost({
      argv: [],
      env: { RAILWAY_ENVIRONMENT_ID: "env_abc" },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(result).toEqual({ host: "0.0.0.0", reason: "railway", isRailway: true });
  });

  it("Railway detection works for preview/staging environments (ID present, name is not production)", () => {
    const result = resolveBindHost({
      argv: [],
      env: {
        RAILWAY_ENVIRONMENT_ID: "env_preview_xyz",
        RAILWAY_ENVIRONMENT_NAME: "pr-217-preview",
      },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(result.host).toBe("0.0.0.0");
    expect(result.isRailway).toBe(true);
  });

  it("Railway takes precedence over --lan/--tailscale (Railway wins, not dev-only defaults)", () => {
    const result = resolveBindHost({
      argv: ["--tailscale"],
      env: { RAILWAY_SERVICE_ID: "svc_abc" },
      findTailscaleAddress: NO_TAILSCALE, // would normally throw — must never be reached
    });
    expect(result).toEqual({ host: "0.0.0.0", reason: "railway", isRailway: true });
  });

  it("Railway does not get 127.0.0.1", () => {
    const result = resolveBindHost({
      argv: [],
      env: { RAILWAY_PROJECT_ID: "proj_abc" },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(result.host).not.toBe("127.0.0.1");
  });
});

describe("findTailscaleAddress (real os.networkInterfaces(), environment-dependent)", () => {
  it("returns null or a valid 100.64.0.0/10 address — never throws", () => {
    const addr = findTailscaleAddress();
    if (addr !== null) {
      const parts = addr.split(".").map(Number);
      expect(parts[0]).toBe(100);
      expect(parts[1]).toBeGreaterThanOrEqual(64);
      expect(parts[1]).toBeLessThanOrEqual(127);
    } else {
      expect(addr).toBeNull();
    }
  });
});
