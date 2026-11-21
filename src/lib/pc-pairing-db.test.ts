import { describe, expect, it, vi } from "vitest";
import { createPcPairingStore } from "./pc-pairing-db";

const pairingId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "a".repeat(64);
const now = "2026-11-20T15:00:00.000Z";
const later = "2026-11-20T15:10:00.000Z";
const device = { id: deviceId, user_id: "alice", fingerprint,
  public_key: "public-key", name: "Office PC", paired_at: now, revoked_at: null };

function db() {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; }),
    is: vi.fn(() => query), not: vi.fn(() => query), gt: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: {
      pairing_id: pairingId, code_hash: "hash", user_id: "alice", created_at: now,
      expires_at: later, claimed_at: now, consumed_at: null,
      fingerprint, public_key: "public-key", name: "Office PC",
    }, error: null })),
    single: vi.fn(async () => ({ data: { expires_at: later }, error: null })),
    insert: vi.fn(() => query),
  };
  const rpc = vi.fn((name: string) => ({
    then: (resolve: (value: { data: boolean | string; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: name === "issue_pc_pairing" ? later : true, error: null })),
    maybeSingle: async () => ({ data: name === "complete_pc_pairing" ? device : null, error: null }),
  }));
  const client = { from: vi.fn(() => query), rpc };
  return { store: createPcPairingStore(client as never), client, query, filters, rpc };
}

describe("Supabase PC pairing store contract", () => {
  it("issues an opaque ID while taking timestamps from the database", async () => {
    const { store, rpc } = db();
    const expiresAt = await store.createSession({
      pairingId, codeHash: "hash", userId: "alice", createdAt: now,
      expiresAt: later, claimedAt: null, consumedAt: null,
      fingerprint: null, publicKey: null, name: null,
    });
    expect(expiresAt).toBe(later);
    expect(rpc).toHaveBeenCalledWith("issue_pc_pairing", {
      p_pairing_id: pairingId, p_code_hash: "hash", p_user_id: "alice",
    });
  });

  it("delegates claim, confirmation, and revocation to atomic database functions", async () => {
    const { store, rpc } = db();
    const claim = { fingerprint, publicKey: "public-key", name: "Office PC" };
    expect(await store.claimSession("hash", claim, now)).toBe(true);
    expect((await store.completeClaim("alice", pairingId, now))?.id).toBe(deviceId);
    expect(await store.revokeDevice("alice", deviceId, now)).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_pc_pairing", {
      p_code_hash: "hash", p_fingerprint: fingerprint,
      p_public_key: "public-key", p_name: "Office PC",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_pc_pairing", {
      p_user_id: "alice", p_pairing_id: pairingId,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "revoke_pc_device", {
      p_user_id: "alice", p_device_id: deviceId,
    });
  });

  it("scopes polling to the verified owner and opaque ID", async () => {
    const { store, filters } = db();
    expect((await store.peekClaim("alice", pairingId, now))?.fingerprint).toBe(fingerprint);
    expect(filters).toContainEqual(["pairing_id", pairingId]);
    expect(filters).toContainEqual(["user_id", "alice"]);
  });
});
