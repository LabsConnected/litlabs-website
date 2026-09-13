import { describe, expect, it } from "vitest";
import {
  findTailscaleAddress,
  isRailwayRuntime,
  parseNetworkFlags,
  resolveBindHost,
  stripNetworkFlags,
} from "../scripts/resolve-dev-host.mjs";

const NO_TAILSCALE = () => null;
const FAKE_TAILSCALE = () => "100.107.123.73";

describe("isRailwayRuntime", () => {
  it("false with no markers", () => {
    expect(isRailwayRuntime({})).toBe(false);
  });

  it("true on any of the three ID markers (covers preview/staging, not just prod)", () => {
    expect(isRailwayRuntime({ RAILWAY_ENVIRONMENT_ID: "e" })).toBe(true);
    expect(isRailwayRuntime({ RAILWAY_SERVICE_ID: "s" })).toBe(true);
    expect(isRailwayRuntime({ RAILWAY_PROJECT_ID: "p" })).toBe(true);
  });

  it("is NOT satisfied by RAILWAY_ENVIRONMENT_NAME alone", () => {
    expect(isRailwayRuntime({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(false);
  });
});

describe("stripNetworkFlags", () => {
  it("removes --lan and --tailscale, keeps everything else", () => {
    expect(stripNetworkFlags(["--turbo", "-p", "3001", "--lan"])).toEqual([
      "--turbo",
      "-p",
      "3001",
    ]);
    expect(stripNetworkFlags(["--tailscale", "--webpack"])).toEqual(["--webpack"]);
  });
});

describe("resolveBindHost — LOCAL", () => {
  it("default host is 127.0.0.1", () => {
    const r = resolveBindHost({ argv: [], env: {}, findTailscaleAddress: NO_TAILSCALE });
    expect(r).toEqual({ host: "127.0.0.1", reason: "default-local", isRailway: false });
  });

  it("--lan enables intentional LAN exposure", () => {
    const r = resolveBindHost({ argv: ["--lan"], env: {}, findTailscaleAddress: NO_TAILSCALE });
    expect(r).toEqual({ host: "0.0.0.0", reason: "lan", isRailway: false });
  });

  it("--tailscale behaves correctly when an interface is found", () => {
    const r = resolveBindHost({
      argv: ["--tailscale"],
      env: {},
      findTailscaleAddress: FAKE_TAILSCALE,
    });
    expect(r).toEqual({ host: "100.107.123.73", reason: "tailscale", isRailway: false });
  });

  it("--tailscale throws (never silently 0.0.0.0) when no interface is found", () => {
    expect(() =>
      resolveBindHost({ argv: ["--tailscale"], env: {}, findTailscaleAddress: NO_TAILSCALE }),
    ).toThrow(/no Tailscale interface\/IP was found/);
  });

  it("no flag combination accidentally binds 0.0.0.0", () => {
    for (const argv of [[], ["--turbo"], ["-p", "3001"]]) {
      const r = resolveBindHost({ argv, env: {}, findTailscaleAddress: NO_TAILSCALE });
      expect(r.host).not.toBe("0.0.0.0");
      expect(r.host).not.toBe("::");
    }
  });
});

describe("resolveBindHost — RAILWAY", () => {
  it("Railway markers force deploy-compatible 0.0.0.0 binding", () => {
    const r = resolveBindHost({
      argv: [],
      env: { RAILWAY_ENVIRONMENT_ID: "env_abc" },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(r).toEqual({ host: "0.0.0.0", reason: "railway", isRailway: true });
  });

  it("preview/staging Railway environments (ID present, name != production) still work", () => {
    const r = resolveBindHost({
      argv: [],
      env: {
        RAILWAY_ENVIRONMENT_ID: "env_preview",
        RAILWAY_ENVIRONMENT_NAME: "pr-217-preview",
      },
      findTailscaleAddress: NO_TAILSCALE,
    });
    expect(r.host).toBe("0.0.0.0");
    expect(r.isRailway).toBe(true);
  });

  it("Railway never gets 127.0.0.1, and wins over --lan/--tailscale", () => {
    const r = resolveBindHost({
      argv: ["--tailscale"],
      env: { RAILWAY_SERVICE_ID: "svc_abc" },
      findTailscaleAddress: NO_TAILSCALE, // must not be consulted
    });
    expect(r.host).not.toBe("127.0.0.1");
    expect(r).toEqual({ host: "0.0.0.0", reason: "railway", isRailway: true });
  });
});

describe("findTailscaleAddress (real os.networkInterfaces())", () => {
  it("never throws; returns null or a valid 100.64.0.0/10 address", () => {
    const addr = findTailscaleAddress();
    if (addr !== null) {
      const parts = addr.split(".").map(Number);
      expect(parts[0]).toBe(100);
      expect(parts[1]).toBeGreaterThanOrEqual(64);
      expect(parts[1]).toBeLessThanOrEqual(127);
    }
  });
});

describe("parseNetworkFlags", () => {
  it("detects flags independently and defaults to false", () => {
    expect(parseNetworkFlags(["--lan"])).toEqual({ lan: true, tailscale: false });
    expect(parseNetworkFlags(["--tailscale"])).toEqual({ lan: false, tailscale: true });
    expect(parseNetworkFlags([])).toEqual({ lan: false, tailscale: false });
  });
});
