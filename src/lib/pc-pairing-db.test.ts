import { describe, expect, it } from "vitest";
import { createPcPairingStore } from "./pc-pairing-db";

type Row = Record<string, unknown>;

class FakeQuery {
  private predicates: Array<(row: Row) => boolean> = [];
  private patch: Row | null = null;
  private insertion: Row | null = null;
  constructor(private readonly rows: Row[]) {}
  select(_columns = "*") { return this; }
  eq(column: string, value: unknown) { this.predicates.push((r) => r[column] === value); return this; }
  is(column: string, value: null) { this.predicates.push((r) => r[column] === value); return this; }
  not(column: string, operator: string, value: null) {
    if (operator !== "is") throw new Error("unexpected filter");
    this.predicates.push((r) => r[column] !== value); return this;
  }
  gt(column: string, value: string) { this.predicates.push((r) => String(r[column]) > value); return this; }
  order() { return this; }
  update(patch: Row) { this.patch = patch; return this; }
  insert(row: Row) { this.insertion = row; return this; }
  private execute() {
    if (this.insertion) {
      const row = { id: `device-${this.rows.length + 1}`, ...this.insertion };
      this.rows.push(row);
      return { data: row, error: null };
    }
    const found = this.rows.filter((r) => this.predicates.every((p) => p(r)));
    if (this.patch && found[0]) Object.assign(found[0], this.patch);
    return { data: found[0] ?? null, error: null };
  }
  async maybeSingle() { return this.execute(); }
  async single() { return this.execute(); }
  then(resolve: (value: { data: Row[]; error: null }) => unknown) {
    if (this.insertion) this.execute();
    const found = this.rows.filter((r) => this.predicates.every((p) => p(r)));
    return Promise.resolve(resolve({ data: found.map((r) => ({ ...r })), error: null }));
  }
}

function db(initial: { sessions?: Row[]; devices?: Row[] } = {}) {
  const sessions = initial.sessions ?? [];
  const devices = initial.devices ?? [];
  const client = {
    from: (table: string) => new FakeQuery(table === "pc_pairing_sessions" ? sessions : devices),
    rpc: (name: string, args: { p_user_id: string; p_code_hash: string }) => ({
      maybeSingle: async () => {
        if (name !== "complete_pc_pairing") throw new Error("Unexpected RPC");
        const session = sessions.find((s) => s.user_id === args.p_user_id &&
          s.code_hash === args.p_code_hash && s.claimed_at && !s.consumed_at &&
          String(s.expires_at) > now);
        if (!session) return { data: null, error: null };
        session.consumed_at = now;
        let device = devices.find((d) => d.user_id === args.p_user_id && d.fingerprint === session.fingerprint);
        if (!device) {
          device = { id: `device-${devices.length + 1}`, user_id: args.p_user_id,
            fingerprint: session.fingerprint };
          devices.push(device);
        }
        Object.assign(device, { public_key: session.public_key, name: session.name,
          paired_at: now, revoked_at: null });
        return { data: { ...device }, error: null };
      },
    }),
  };
  return { sessions, devices, store: createPcPairingStore(client as never) };
}

const now = "2026-11-20T15:00:00.000Z";
const later = "2026-11-20T15:10:00.000Z";
const fingerprint = "a".repeat(64);
const claim = { fingerprint, publicKey: "key", name: "Office PC" };

describe("Supabase PC pairing store", () => {
  it("keeps a claim invisible to another account and consumes it once", async () => {
    const { store } = db({ sessions: [{
      code_hash: "hash", user_id: "alice", expires_at: later,
      claimed_at: now, consumed_at: null, fingerprint, public_key: "key", name: "Office PC",
    }] });
    expect(await store.peekClaim("bob", "hash", now)).toBeNull();
    expect(await store.completeClaim("bob", "hash", now)).toBeNull();
    expect((await store.completeClaim("alice", "hash", now))?.fingerprint).toBe(fingerprint);
    expect(await store.completeClaim("alice", "hash", now)).toBeNull();
  });

  it("preserves the existing device ID and limits revocation to its owner", async () => {
    const { store, devices } = db({ devices: [{
      id: "existing-id", user_id: "alice", fingerprint, public_key: "key", name: "Old",
      paired_at: now, revoked_at: now,
    }], sessions: [{ code_hash: "hash", user_id: "alice", expires_at: later,
      claimed_at: now, consumed_at: null, fingerprint, public_key: "key", name: "Office PC" }] });
    expect(await store.revokeDevice("bob", "existing-id", now)).toBe(false);
    const restored = await store.completeClaim("alice", "hash", now);
    expect(restored).toMatchObject({ id: "existing-id", userId: "alice", revokedAt: null });
    expect(devices).toHaveLength(1);
    expect(await store.revokeDevice("alice", "existing-id", later)).toBe(true);
    expect((await store.listDevices("alice"))[0].revokedAt).toBe(later);
    expect(await store.listDevices("bob")).toEqual([]);
  });

  it("refuses an expired or previously claimed pairing session", async () => {
    const { store } = db({ sessions: [{
      code_hash: "hash", user_id: "alice", expires_at: later,
      claimed_at: null, consumed_at: null,
    }] });
    expect(await store.claimSession("hash", claim, later)).toBe(false);
    expect(await store.claimSession("hash", claim, now)).toBe(true);
    expect(await store.claimSession("hash", claim, now)).toBe(false);
  });
});
