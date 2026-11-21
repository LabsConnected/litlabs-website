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
    return session.expiresAt;
  }
  async claimSession(codeHash: string, claim: { fingerprint: string; publicKey: string; name: string }, now: string) {
    const s = this.sessions.get(codeHash);
    if (!s || s.claimedAt || s.consumedAt || s.expiresAt <= now) return false;
    const existing = this.devices.find((d) => d.fingerprint === claim.fingerprint);
    if (existing && (existing.userId !== s.userId ||
        (existing.revokedAt && s.createdAt <= existing.revokedAt))) return false;
    Object.assign(s, { ...claim, claimedAt: now });
    return true;
  }
  async completeClaim(userId: string, pairingId: string, now: string) {
    const s = [...this.sessions.values()].find((v) => v.pairingId === pairingId);
    if (!s || s.userId !== userId || !s.claimedAt || s.consumedAt || s.expiresAt <= now) return null;
    if (!s.fingerprint || !s.publicKey || !s.name) return null;
    if (this.failActivation) throw new Error("database unavailable");
    if (this.devices.some((v) => v.fingerprint === s.fingerprint && v.userId !== userId))
      throw new Error("Device belongs to another account");
    let d = this.devices.find((v) => v.userId === userId && v.fingerprint === s.fingerprint);
    if (d?.revokedAt && s.createdAt <= d.revokedAt) return null;
    s.consumedAt = now;
    if (!d) {
      d = { id: `device-${this.devices.length + 1}`, userId, fingerprint: s.fingerprint,
        publicKey: s.publicKey, name: s.name, pairedAt: now, revokedAt: null };
      this.devices.push(d);
    } else {
      Object.assign(d, { name: s.name, publicKey: s.publicKey, revokedAt: null });
    }
    return { ...d };
  }
  async peekClaim(userId: string, pairingId: string, now: string) {
    const s = [...this.sessions.values()].find((v) => v.pairingId === pairingId);
    return s && s.userId === userId && s.claimedAt && !s.consumedAt && s.expiresAt > now ? { ...s } : null;
  }
  async listDevices(userId: string) {
    return this.devices.filter((d) => d.userId === userId).map((d) => ({ ...d }));
  }
  async revokeDevice(userId: string, id: string, now: string) {
    const d = this.devices.find((v) => v.userId === userId && v.id === id && !v.revokedAt);
    if (!d) return false;
    d.revokedAt = now;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.fingerprint === d.fingerprint &&
          !session.consumedAt && session.createdAt <= now) session.consumedAt = now;
    }
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
    const { code, pairingId } = await service.createCode("user-a");
    expect(await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "Alice PC" })).toBe(true);
    expect(await service.peekClaim("user-b", pairingId)).toBeNull();
    expect(await service.peekClaim("user-a", pairingId)).toEqual({ fingerprint, name: "Alice PC" });
    expect(await service.completePairing("user-b", pairingId)).toBeNull();
    expect(store.devices).toHaveLength(0);
    const device = await service.completePairing("user-a", pairingId);
    expect(device).toMatchObject({ id: "device-1", userId: "user-a", fingerprint, revokedAt: null });
    expect(await service.completePairing("user-a", pairingId)).toBeNull();
  });

  it("re-pairs a revoked key into the same device row only after a fresh code", async () => {
    const first = await service.createCode("user-a");
    await service.claimFromAgent(first.code, { fingerprint, publicKey: key, name: "Alice PC" });
    const device = (await service.completePairing("user-a", first.pairingId))!;
    expect(await service.revokeDevice("user-b", device.id)).toBe(false);
    expect(await service.revokeDevice("user-a", device.id)).toBe(true);
    expect((await service.listDevices("user-a"))[0].revokedAt).not.toBeNull();
    expect(await service.completePairing("user-a", first.pairingId)).toBeNull();

    now.setTime(now.getTime() + 1);
    const fresh = await service.createCode("user-a");
    await service.claimFromAgent(fresh.code, { fingerprint, publicKey: key, name: "Renamed PC" });
    const restored = (await service.completePairing("user-a", fresh.pairingId))!;
    expect(restored).toMatchObject({ id: device.id, name: "Renamed PC", revokedAt: null });
    expect(store.devices).toHaveLength(1);
  });

  it("rejects a forged fingerprint and an expired code", async () => {
    const { code, pairingId } = await service.createCode("user-a");
    expect(await service.claimFromAgent(code, { fingerprint: "0".repeat(64), publicKey: key, name: "fake" })).toBe(false);
    now.setTime(now.getTime() + 11 * 60_000);
    expect(await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "late" })).toBe(false);
    expect(await service.completePairing("user-a", pairingId)).toBeNull();
  });

  it("does not let a second account take an existing device identity", async () => {
    const alice = await service.createCode("user-a");
    await service.claimFromAgent(alice.code, { fingerprint, publicKey: key, name: "Shared PC" });
    await service.completePairing("user-a", alice.pairingId);
    const bob = await service.createCode("user-b");
    expect(await service.claimFromAgent(bob.code, { fingerprint, publicKey: key, name: "Shared PC" })).toBe(false);
    expect(await service.completePairing("user-b", bob.pairingId)).toBeNull();
    expect(store.devices).toHaveLength(1);
    expect((await service.listDevices("user-a"))[0].revokedAt).toBeNull();
  });

  it("rolls back confirmation on activation failure and consumes it only after success", async () => {
    const { code, pairingId } = await service.createCode("user-a");
    await service.claimFromAgent(code, { fingerprint, publicKey: key, name: "Alice PC" });
    store.failActivation = true;
    await expect(service.completePairing("user-a", pairingId)).rejects.toThrow("database unavailable");
    store.failActivation = false;
    expect(await service.completePairing("user-a", pairingId)).not.toBeNull();
    expect(await service.completePairing("user-a", pairingId)).toBeNull();
  });

  it("rejects a claim pending when the owner revokes its existing device", async () => {
    const first = await service.createCode("user-a");
    await service.claimFromAgent(first.code, { fingerprint, publicKey: key, name: "Alice PC" });
    const device = (await service.completePairing("user-a", first.pairingId))!;
    const pending = await service.createCode("user-a");
    await service.claimFromAgent(pending.code, { fingerprint, publicKey: key, name: "Alice PC" });
    now.setTime(now.getTime() + 1);
    expect(await service.revokeDevice("user-a", device.id)).toBe(true);
    expect(await service.completePairing("user-a", pending.pairingId)).toBeNull();
    expect((await service.listDevices("user-a"))[0].revokedAt).not.toBeNull();
  });

  it("rejects a pre-revocation code even when the PC claims it later", async () => {
    const first = await service.createCode("user-a");
    await service.claimFromAgent(first.code, { fingerprint, publicKey: key, name: "PC" });
    const device = (await service.completePairing("user-a", first.pairingId))!;
    const pending = await service.createCode("user-a");
    now.setTime(now.getTime() + 1);
    await service.revokeDevice("user-a", device.id);
    expect(await service.claimFromAgent(pending.code, { fingerprint, publicKey: key, name: "PC" })).toBe(false);
    expect(await service.completePairing("user-a", pending.pairingId)).toBeNull();
  });

  it("lets exactly one of two concurrent claims win and rejects replay", async () => {
    const session = await service.createCode("user-a");
    const claim = { fingerprint, publicKey: key, name: "PC" };
    const results = await Promise.all([
      service.claimFromAgent(session.code, claim),
      service.claimFromAgent(session.code, claim),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await service.claimFromAgent(session.code, claim)).toBe(false);
    expect(await service.completePairing("user-a", session.pairingId)).not.toBeNull();
    expect(await service.completePairing("user-a", session.pairingId)).toBeNull();
  });

  it("keeps the final state revoked when confirmation wins before revocation", async () => {
    const first = await service.createCode("user-a");
    await service.claimFromAgent(first.code, { fingerprint, publicKey: key, name: "PC" });
    const device = (await service.completePairing("user-a", first.pairingId))!;
    const pending = await service.createCode("user-a");
    await service.claimFromAgent(pending.code, { fingerprint, publicKey: key, name: "PC" });
    await service.completePairing("user-a", pending.pairingId);
    now.setTime(now.getTime() + 1);
    await service.revokeDevice("user-a", device.id);
    expect((await service.listDevices("user-a"))[0].revokedAt).not.toBeNull();
  });
});
