import { describe, expect, it, vi, afterEach } from "vitest";
import { isBlockedIp, isBlockedHostname, validateOutboundHost } from "./ssrf-guard";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  // Same fn for both interop shapes — consumers may hit named or default.
  return { ...actual, default: { ...actual, lookup: lookupMock }, lookup: lookupMock };
});

describe("isBlockedIp — IPv4", () => {
  const blocked = [
    "0.0.0.0", "0.1.2.3",          // this-network / unspecified
    "10.0.0.1", "10.255.255.255",  // private
    "100.64.0.1", "100.127.9.9",   // CGNAT
    "127.0.0.1", "127.0.0.2", "127.255.0.1", // entire loopback /8
    "169.254.169.254",             // link-local / cloud metadata
    "172.16.0.1", "172.31.255.254",// private (the reported gap)
    "192.0.2.1",                   // TEST-NET-1
    "192.88.99.1",                 // 6to4 relay anycast
    "192.168.1.1",                 // private
    "198.18.0.1", "198.19.0.1",    // benchmarking
    "198.51.100.1",                // TEST-NET-2
    "203.0.113.1",                 // TEST-NET-3
    "224.0.0.1", "239.255.255.255",// multicast
    "240.0.0.1", "255.255.255.255",// reserved/broadcast
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  it("allows public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just outside 172.16/12
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });
});

describe("isBlockedIp — IPv6", () => {
  const blocked = [
    "::1",                    // loopback
    "::",                     // unspecified
    "fc00::1", "fd12::1",     // unique local
    "fe80::1", "fe9f::1",     // link-local
    "fec0::1",                // site-local (deprecated)
    "ff02::1",                // multicast
    "2001:db8::1",            // documentation
    "2001::1",                // Teredo (embeds IPv4)
    "2002:0a00:1::1",         // 6to4 (embeds 10.0.0.1)
    "64:ff9b::7f00:1",        // NAT64 embedding 127.0.0.1
    // IPv4-mapped — the reported capture.ts bypass:
    "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1", "::ffff:0a00:1",
    "::ffff:172.16.0.5", "::ffff:ac10:5",
    // IPv4-compatible (::a.b.c.d):
    "::127.0.0.1", "::7f00:1", "::10.0.0.1",
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  it("fails closed on unparseable input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("999.1.1.1")).toBe(true);
  });
});

describe("isBlockedHostname", () => {
  it("blocks conventional internal hostnames", () => {
    for (const h of ["localhost", "app.localhost", "svc.internal", "printer.local", "host.localdomain"]) {
      expect(isBlockedHostname(h)).toBe(true);
    }
  });
  it("does not block public names", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("internal.example.com")).toBe(false); // public suffix, DNS decides
  });
});

describe("validateOutboundHost", () => {
  afterEach(() => lookupMock.mockReset());

  it("rejects blocked literals without touching DNS", async () => {
    expect((await validateOutboundHost("172.16.0.5")).ok).toBe(false);
    expect((await validateOutboundHost("[::ffff:127.0.0.1]")).ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a public literal without DNS", async () => {
    expect((await validateOutboundHost("8.8.8.8")).ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname whose DNS answers include a blocked address", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 }, // rebind answer
    ] as never);
    const verdict = await validateOutboundHost("rebind.example.com");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/blocked/i);
  });

  it("accepts a hostname resolving only to public addresses", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ] as never);
    expect((await validateOutboundHost("example.com")).ok).toBe(true);
  });

  it("fails closed when DNS cannot resolve the host", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND") as never);
    const verdict = await validateOutboundHost("nonexistent.invalid");
    expect(verdict.ok).toBe(false);
  });
});
