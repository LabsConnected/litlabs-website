// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns", () => ({
  default: { promises: { lookup: mocks.lookup } },
  promises: { lookup: mocks.lookup },
}));

import {
  DestinationBlockedError,
  clearDestinationCache,
  pinnedDispatcherFor,
  resolvePublicAddresses,
} from "./proxy-destination";

const PUBLIC_V4 = [{ address: "93.184.216.34", family: 4 }];
const PUBLIC_V6 = [{ address: "2606:4700:10::1", family: 6 }];

beforeEach(() => {
  vi.clearAllMocks();
  clearDestinationCache();
});

describe("resolvePublicAddresses", () => {
  it("returns addresses when every answer is public", async () => {
    mocks.lookup.mockResolvedValue([...PUBLIC_V4, ...PUBLIC_V6]);
    const out = await resolvePublicAddresses("example.com");
    expect(out).toHaveLength(2);
    expect(mocks.lookup).toHaveBeenCalledWith("example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("fails closed when ANY answer is non-public", async () => {
    mocks.lookup.mockResolvedValue([
      ...PUBLIC_V4,
      { address: "192.168.1.1", family: 4 }, // one bad apple poisons it
    ]);
    await expect(resolvePublicAddresses("rebind.example.com")).rejects.toThrow(
      DestinationBlockedError,
    );
    await expect(resolvePublicAddresses("rebind.example.com")).rejects.toThrow(/non-public/);
  });

  it("blocks each non-public family", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(resolvePublicAddresses("evil.example.com"), address).rejects.toThrow(DestinationBlockedError);
    }
  });

  it("fails closed on resolution errors and empty answers", async () => {
    mocks.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolvePublicAddresses("nope.invalid")).rejects.toThrow(DestinationBlockedError);

    mocks.lookup.mockResolvedValue([]);
    await expect(resolvePublicAddresses("empty.invalid")).rejects.toThrow(/did not resolve/);
  });
});

describe("pinnedDispatcherFor", () => {
  it("returns undefined for IP literals (policy already classified them)", async () => {
    expect(await pinnedDispatcherFor("93.184.216.34")).toBeUndefined();
    expect(await pinnedDispatcherFor("[2606:4700:10::1]")).toBeUndefined();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("returns a dispatcher for public hostnames and caches it", async () => {
    mocks.lookup.mockResolvedValue(PUBLIC_V4);
    const d1 = await pinnedDispatcherFor("example.com");
    const d2 = await pinnedDispatcherFor("example.com");
    expect(d1).toBeDefined();
    expect(d1).toBe(d2); // cache hit — DNS consulted once
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it("propagates DestinationBlockedError for unsafe resolutions", async () => {
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(pinnedDispatcherFor("localhost.evil.com")).rejects.toThrow(DestinationBlockedError);
  });
});
