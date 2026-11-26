import { describe, expect, it } from "vitest";
import { ipBlockReason, parseIPv6 } from "./ip-address-safety";

describe("ipBlockReason — IPv4", () => {
  it("allows public unicast addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "104.20.23.154", "192.0.32.10"]) {
      expect(ipBlockReason(ip), ip).toBeNull();
    }
  });

  it("blocks loopback", () => {
    for (const ip of ["127.0.0.1", "127.53.0.9", "127.255.255.255"]) {
      expect(ipBlockReason(ip), ip).toMatch(/loopback/);
    }
  });

  it("blocks private RFC 1918 ranges", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.168.255.255"]) {
      expect(ipBlockReason(ip), ip).toMatch(/private/);
    }
    // Just outside the ranges stays public.
    expect(ipBlockReason("172.15.255.255")).toBeNull();
    expect(ipBlockReason("172.32.0.1")).toBeNull();
  });

  it("blocks CGNAT shared address space", () => {
    for (const ip of ["100.64.0.1", "100.100.100.200", "100.127.255.255"]) {
      const r = ipBlockReason(ip);
      expect(r, ip).toBeTruthy();
    }
    expect(ipBlockReason("100.63.255.255")).toBeNull();
    expect(ipBlockReason("100.128.0.1")).toBeNull();
    // Alibaba metadata IP gets its specific reason.
    expect(ipBlockReason("100.100.100.200")).toMatch(/metadata/);
  });

  it("blocks link-local and cloud metadata", () => {
    expect(ipBlockReason("169.254.10.20")).toMatch(/link-local/);
    expect(ipBlockReason("169.254.169.254")).toMatch(/metadata/);
    expect(ipBlockReason("192.0.0.192")).toMatch(/metadata/);
  });

  it("blocks unspecified, documentation, benchmarking, multicast, reserved", () => {
    expect(ipBlockReason("0.0.0.0")).toMatch(/unspecified/);
    expect(ipBlockReason("0.1.2.3")).toMatch(/unspecified/);
    expect(ipBlockReason("192.0.2.1")).toMatch(/documentation/);
    expect(ipBlockReason("198.51.100.7")).toMatch(/documentation/);
    expect(ipBlockReason("203.0.113.9")).toMatch(/documentation/);
    expect(ipBlockReason("198.18.0.1")).toMatch(/benchmarking/);
    expect(ipBlockReason("198.19.255.1")).toMatch(/benchmarking/);
    expect(ipBlockReason("224.0.0.1")).toMatch(/multicast/);
    expect(ipBlockReason("239.1.2.3")).toMatch(/multicast/);
    expect(ipBlockReason("240.0.0.1")).toMatch(/reserved/);
    expect(ipBlockReason("255.255.255.255")).toMatch(/reserved/);
  });
});

describe("ipBlockReason — IPv6", () => {
  it("allows public unicast addresses", () => {
    for (const ip of ["2606:4700:10::ac42:93f3", "2001:4860:4860::8888", "2a00:1450:4001::1"]) {
      expect(ipBlockReason(ip), ip).toBeNull();
    }
  });

  it("blocks loopback, unspecified, ULA, link-local, multicast", () => {
    expect(ipBlockReason("::1")).toMatch(/loopback/);
    expect(ipBlockReason("::")).toMatch(/unspecified/);
    expect(ipBlockReason("fd00::1")).toMatch(/ULA|private/);
    expect(ipBlockReason("fc00::1")).toMatch(/ULA|private/);
    expect(ipBlockReason("fdff:ffff::1")).toMatch(/ULA|private/);
    expect(ipBlockReason("fe80::1")).toMatch(/link-local/);
    expect(ipBlockReason("febf::1")).toMatch(/link-local/);
    expect(ipBlockReason("ff02::1")).toMatch(/multicast/);
  });

  it("blocks documentation, benchmarking, Teredo, 6to4, ORCHID, SRv6, discard", () => {
    expect(ipBlockReason("2001:db8::1")).toMatch(/documentation/);
    expect(ipBlockReason("3fff::1")).toMatch(/documentation/);
    expect(ipBlockReason("2001:2::1")).toMatch(/benchmarking/);
    expect(ipBlockReason("2001::1")).toMatch(/Teredo/);
    expect(ipBlockReason("2002::1")).toMatch(/6to4/);
    expect(ipBlockReason("2001:10::1")).toMatch(/ORCHID/);
    expect(ipBlockReason("2001:20::1")).toMatch(/ORCHID/);
    expect(ipBlockReason("5f00::1")).toMatch(/segment/);
    expect(ipBlockReason("100::1")).toMatch(/discard/);
    expect(ipBlockReason("64:ff9b:1::1")).toMatch(/NAT64/);
  });

  it("delegates IPv4-mapped IPv6 to the IPv4 classifier", () => {
    expect(ipBlockReason("::ffff:127.0.0.1")).toMatch(/IPv4-mapped.*loopback/);
    expect(ipBlockReason("::ffff:7f00:1")).toMatch(/IPv4-mapped.*loopback/);
    expect(ipBlockReason("::ffff:169.254.169.254")).toMatch(/IPv4-mapped.*metadata/);
    expect(ipBlockReason("::ffff:10.0.0.1")).toMatch(/IPv4-mapped.*private/);
    expect(ipBlockReason("::ffff:192.168.0.1")).toMatch(/IPv4-mapped.*private/);
    // Public embedded IPv4 → public destination.
    expect(ipBlockReason("::ffff:8.8.8.8")).toBeNull();
  });

  it("delegates NAT64 well-known prefix embedded IPv4", () => {
    expect(ipBlockReason("64:ff9b::7f00:1")).toMatch(/NAT64.*loopback/);
    expect(ipBlockReason("64:ff9b::a9fe:a9fe")).toMatch(/NAT64.*metadata/);
    expect(ipBlockReason("64:ff9b::808:808")).toBeNull(); // 8.8.8.8 public
  });

  it("blocks deprecated IPv4-compatible ::/96", () => {
    expect(ipBlockReason("::8.8.8.8")).toMatch(/IPv4-compatible/);
    expect(ipBlockReason("::127.0.0.1")).toMatch(/IPv4-compatible|loopback/);
  });

  it("handles bracketed and zone-id forms", () => {
    expect(ipBlockReason("[::1]")).toMatch(/loopback/);
    expect(ipBlockReason("fe80::1%eth0")).toMatch(/link-local/);
  });
});

describe("ipBlockReason — non-IP input", () => {
  it("returns null for hostnames and garbage", () => {
    expect(ipBlockReason("example.com")).toBeNull();
    expect(ipBlockReason("")).toBeNull();
    expect(ipBlockReason("not-an-ip")).toBeNull();
    expect(ipBlockReason("999.1.1.1")).toBeNull(); // invalid octet → not an IP literal
  });
});

describe("parseIPv6", () => {
  it("parses full, compressed and embedded-IPv4 forms", () => {
    expect(parseIPv6("2001:4860:4860::8888")).toHaveLength(8);
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("not ipv6")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});
