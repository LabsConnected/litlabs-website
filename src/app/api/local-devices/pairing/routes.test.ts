import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/pc-pairing-runtime", () => ({ getPcPairingService: vi.fn() }));
vi.mock("@/lib/pc-pairing-proof", () => ({ verifyPcClaim: vi.fn(() => true) }));

import { auth } from "@/lib/auth";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";
import { verifyPcClaim } from "@/lib/pc-pairing-proof";
import { POST as create } from "./route";
import { GET as peek, POST as confirm } from "./claim/route";
import { POST as deviceClaim } from "./device-claim/route";
import { GET as list } from "../route";
import { DELETE as revoke } from "../[deviceId]/route";

const service = {
  createCode: vi.fn(async () => ({ code: "ABCDEFGHJKMN", expiresAt: "tomorrow" })),
  peekClaim: vi.fn(async () => ({ name: "Office PC", fingerprint: "a".repeat(64) })),
  completeCode: vi.fn(async () => ({ id: "device" })),
  claimFromAgent: vi.fn(async () => true),
  listDevices: vi.fn(async () => []),
  revokeDevice: vi.fn(async () => true),
};
const req = (path: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "alice" } as never);
  vi.mocked(getPcPairingService).mockReturnValue(service as never);
  vi.mocked(verifyPcClaim).mockReturnValue(true);
});

describe("PC pairing API", () => {
  it("requires auth before code creation, claim inspection, confirmation, listing and revocation", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    expect((await create(req("/api/local-devices/pairing", "POST"))).status).toBe(401);
    expect((await peek(req("/api/local-devices/pairing/claim?code=ABCDEFGHJKMN"))).status).toBe(401);
    expect((await confirm(req("/api/local-devices/pairing/claim", "POST", { code: "ABCDEFGHJKMN" }))).status).toBe(401);
    expect((await list(req("/api/local-devices"))).status).toBe(401);
    expect((await revoke(req("/api/local-devices/00000000-0000-0000-0000-000000000000", "DELETE"),
      { params: Promise.resolve({ deviceId: "00000000-0000-0000-0000-000000000000" }) })).status).toBe(401);
    expect(getPcPairingService).not.toHaveBeenCalled();
  });

  it("passes only the verified owner ID to owner-scoped operations", async () => {
    await create(req("/api/local-devices/pairing", "POST"));
    await peek(req("/api/local-devices/pairing/claim?code=ABCDEFGHJKMN"));
    await confirm(req("/api/local-devices/pairing/claim", "POST", { code: "ABCDEFGHJKMN" }));
    await list(req("/api/local-devices"));
    await revoke(req("/api/local-devices/00000000-0000-0000-0000-000000000000", "DELETE"),
      { params: Promise.resolve({ deviceId: "00000000-0000-0000-0000-000000000000" }) });
    expect(service.createCode).toHaveBeenCalledWith("alice");
    expect(service.peekClaim).toHaveBeenCalledWith("alice", "ABCDEFGHJKMN");
    expect(service.completeCode).toHaveBeenCalledWith("alice", "ABCDEFGHJKMN");
    expect(service.listDevices).toHaveBeenCalledWith("alice");
    expect(service.revokeDevice).toHaveBeenCalledWith("alice", "00000000-0000-0000-0000-000000000000");
  });

  it("rejects invalid proof before storing the public device claim", async () => {
    vi.mocked(verifyPcClaim).mockReturnValue(false);
    const body = { code: "ABCDEFGHJKMN", publicKey: "key", fingerprint: "a".repeat(64),
      name: "PC", signature: "bad" };
    expect((await deviceClaim(req("/api/local-devices/pairing/device-claim", "POST", body))).status).toBe(400);
    expect(service.claimFromAgent).not.toHaveBeenCalled();
    vi.mocked(verifyPcClaim).mockReturnValue(true);
    expect((await deviceClaim(req("/api/local-devices/pairing/device-claim", "POST", body))).status).toBe(202);
    expect(service.claimFromAgent).toHaveBeenCalledWith(body.code, body);
  });

  it("rejects cross-site owner mutations", async () => {
    const crossSite = (path: string, method: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
      method, headers: { origin: "https://attacker.example", "Content-Type": "application/json",
        "sec-fetch-site": "cross-site" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect((await create(crossSite("/api/local-devices/pairing", "POST"))).status).toBe(403);
    expect((await confirm(crossSite("/api/local-devices/pairing/claim", "POST", { code: "ABCDEFGHJKMN" }))).status).toBe(403);
    expect((await revoke(crossSite("/api/local-devices/00000000-0000-0000-0000-000000000000", "DELETE"),
      { params: Promise.resolve({ deviceId: "00000000-0000-0000-0000-000000000000" }) })).status).toBe(403);
    expect(service.createCode).not.toHaveBeenCalled();
    expect(service.completeCode).not.toHaveBeenCalled();
    expect(service.revokeDevice).not.toHaveBeenCalled();
  });
});
