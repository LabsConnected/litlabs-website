import { createHash, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PcPairingService, type PairingStore, type PairingSession, type PairedPc } from "./pc-pairing";

const key = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).publicKey;
const fingerprint = createHash("sha256").update(`litt-local-device:${key}`).digest("hex");

class MemoryStore implements PairingStore {
  sessions = new Map<string, PairingSession>();
  devices: PairedPc[] = [];
  failActivation = false;

  async createSession(session: PairingSession) {
    this.sessions.set(session.codeHash, session);
  }
  async claimSession(codeHash: string, claim: { fingerprint: string; publicKey: string; name: string }, now: string) {
    const s = this.sessions.get(codeHash);
    if (!s || s.claimedAt || s.consumedAt || s.expiresAt <= now) return false;
    Object.assign(s, { ...claim, claimedAt: now });
    return true;
  }
  async completeClaim(userId: string, codeHash: string, now: string) {
    const s = this.sessions.get(codeHash);
    if (!s || s.userId !== userId || !s.claimedAt || s.consumedAt || s.expiresAt <= now) return null;
    s.consumedAt = now;
    if (!s.fingerprint || !s.publicKey || !s.name) return null;
    if (this.failActivation) throw new Error("database unavailable");
    if (this.devices.some((v) => v.fingerprint === s.fingerprint && v.userId !== userId))
      throw new Error("Device belongs to another account");
    let d = this.devices.find((v) => v.userId === userId && v.fingerprint === s.fingerprint);
    if (!d) {
      d = { id: `device-${this.devices.length + 1}`, userId, fingerprint: s.fingerprint,
        publicKey: s.publicKey, name: s.name, pairedAt: now, revokedAt: null };
      this.devices.push(d);
    } else {
      Object.assign(d, { name: s.name, publicKey: s.publicKey, revokedAt: null });
    }
    return { ...d };
  }
  async peekClaim(userId: string, codeHash: string, now: string) {
    const s = this.sessions.get(codeHash);
    return s && s.userId === userId && s.claimedAt && !s.consumedAt && s.expiresAt > now ? { ...s } : null;
  }
  async listDevices(userId: string) {
    return this.devices.filter((d) => d.userId === userId).map((d) => ({ ...d }));
  }
  async revokeDevice(userId: string, id: string, now: string) {
    const d = this.devices.find((v) => v.userId === userId && v.id === id && !v.revokedAt);
    if (!d) return false;
    d.revokedAt = now;
    return true;
  }
}

describe("PC pairing", () => {
  let store: MemoryStore;
  let service: PcPairingService;
  const now = new Date("2026-11-20T15:00:00.000Z");

  beforeEach(() => {
    now.setTime(Date.parse("2026-11-20T15:00:00.000Z"));
    store = new MemoryStore();
    service = new PcPairingService(store, () => now);
  });

  it("lets only the code creator complete a signed device claim, once", async () => {
    const { code } = await service.createCode("user-a");
    expect(await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "Alice PC" })).toBe(true);
    expect(await service.peekClaim("user-b", code)).toBeNull();
    expect(await service.peekClaim("user-a", code)).toEqual({ fingerprint, name: "Alice PC" });
    expect(await service.completeCode("user-b", code)).toBeNull();
    expect(store.devices).toHaveLength(0);
    const device = await service.completeCode("user-a", code);
    expect(device).toMatchObject({ id: "device-1", userId: "user-a", fingerprint, revokedAt: null });
    expect(await service.completeCode("user-a", code)).toBeNull();
  });

  it("re-pairs a revoked key into the same device row only after a fresh code", async () => {
    const first = await service.createCode("user-a");
    await service.claimFromAgent(first.code, { fingerprint, publicKey: key, name: "Alice PC" });
    const device = (await service.completeCode("user-a", first.code))!;
    expect(await service.revokeDevice("user-b", device.id)).toBe(false);
    expect(await service.revokeDevice("user-a", device.id)).toBe(true);
    expect((await service.listDevices("user-a"))[0].revokedAt).not.toBeNull();
    expect(await service.completeCode("user-a", first.code)).toBeNull();

    const fresh = await service.createCode("user-a");
    await service.claimFromAgent(fresh.code, { fingerprint, publicKey: key, name: "Renamed PC" });
    const restored = (await service.completeCode("user-a", fresh.code))!;
    expect(restored).toMatchObject({ id: device.id, name: "Renamed PC", revokedAt: null });
    expect(store.devices).toHaveLength(1);
  });

  it("rejects a forged fingerprint and an expired code", async () => {
    const { code } = await service.createCode("user-a");
    expect(await service.claimFromAgent(code, { fingerprint: "0".repeat(64), publicKey: key, name: "fake" })).toBe(false);
    now.setTime(now.getTime() + 11 * 60_000);
    expect(await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "late" })).toBe(false);
    expect(await service.completeCode("user-a", code)).toBeNull();
  });

  it("does not let a second account take an existing device identity", async () => {
    const alice = await service.createCode("user-a");
    await service.claimFromAgent(alice.code, { fingerprint, publicKey: key, name: "Shared PC" });
    await service.completeCode("user-a", alice.code);
    const bob = await service.createCode("user-b");
    await service.claimFromAgent(bob.code, { fingerprint, publicKey: key, name: "Shared PC" });
    await expect(service.completeCode("user-b", bob.code)).rejects.toThrow("another account");
    expect(store.devices).toHaveLength(1);
    expect((await service.listDevices("user-a"))[0].revokedAt).toBeNull();
  });

  it("consumes a claim before activation so an outage cannot replay into a revoked row", async () => {
    const { code } = await service.createCode("user-a");
    await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "Alice PC" });
    store.failActivation = true;
    await expect(service.completeCode("user-a", code)).rejects.toThrow("database unavailable");
    store.failActivation = false;
    expect(await service.completeCode("user-a", code)).toBeNull();
  });
});
