import type { SupabaseClient } from "@supabase/supabase-js";
import type { PairedPc, PairingSession, PairingStore } from "./pc-pairing";

type Row = Record<string, unknown>;

function check(error: { message: string } | null): void {
  if (error) throw new Error(`PC pairing database error: ${error.message}`);
}

function sessionFromRow(row: Row): PairingSession {
  return {
    codeHash: String(row.code_hash), userId: String(row.user_id),
    expiresAt: String(row.expires_at), claimedAt: row.claimed_at as string | null,
    consumedAt: row.consumed_at as string | null,
    fingerprint: row.fingerprint as string | null,
    publicKey: row.public_key as string | null, name: row.name as string | null,
  };
}

function deviceFromRow(row: Row): PairedPc {
  return {
    id: String(row.id), userId: String(row.user_id),
    fingerprint: String(row.fingerprint), publicKey: String(row.public_key),
    name: String(row.name), pairedAt: String(row.paired_at),
    revokedAt: row.revoked_at as string | null,
  };
}

export function createPcPairingStore(db: SupabaseClient): PairingStore {
  return {
    async createSession(session) {
      const { error } = await db.from("pc_pairing_sessions").insert({
        code_hash: session.codeHash, user_id: session.userId,
        expires_at: session.expiresAt, claimed_at: null, consumed_at: null,
      });
      check(error);
    },
    async claimSession(codeHash, claim, now) {
      const { data, error } = await db.from("pc_pairing_sessions")
        .update({ claimed_at: now, fingerprint: claim.fingerprint,
          public_key: claim.publicKey, name: claim.name })
        .eq("code_hash", codeHash).is("claimed_at", null)
        .is("consumed_at", null).gt("expires_at", now)
        .select().maybeSingle();
      check(error);
      return Boolean(data);
    },
    async peekClaim(userId, codeHash, now) {
      const { data, error } = await db.from("pc_pairing_sessions").select()
        .eq("code_hash", codeHash).eq("user_id", userId)
        .not("claimed_at", "is", null).is("consumed_at", null)
        .gt("expires_at", now).maybeSingle();
      check(error);
      return data ? sessionFromRow(data) : null;
    },
    async completeClaim(userId, codeHash) {
      const { data, error } = await db.rpc("complete_pc_pairing", {
        p_user_id: userId, p_code_hash: codeHash,
      }).maybeSingle();
      check(error);
      return data ? deviceFromRow(data as Row) : null;
    },
    async listDevices(userId) {
      const { data, error } = await db.from("local_devices").select()
        .eq("user_id", userId).order("paired_at", { ascending: false });
      check(error);
      return (data ?? []).map(deviceFromRow);
    },
    async revokeDevice(userId, id, now) {
      const { data, error } = await db.from("local_devices")
        .update({ revoked_at: now }).eq("id", id).eq("user_id", userId)
        .is("revoked_at", null).select().maybeSingle();
      check(error);
      return Boolean(data);
    },
  };
}
