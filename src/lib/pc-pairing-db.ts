import type { SupabaseClient } from "@supabase/supabase-js";
import type { PairedPc, PairingSession, PairingStore } from "./pc-pairing";

type Row = Record<string, unknown>;

function check(error: { message: string } | null): void {
  if (error) throw new Error(`PC pairing database error: ${error.message}`);
}

function sessionFromRow(row: Row): PairingSession {
  return {
    pairingId: String(row.pairing_id), codeHash: String(row.code_hash), userId: String(row.user_id),
    createdAt: String(row.created_at), expiresAt: String(row.expires_at), claimedAt: row.claimed_at as string | null,
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
      const { data, error } = await db.rpc("issue_pc_pairing", {
        p_pairing_id: session.pairingId, p_code_hash: session.codeHash,
        p_user_id: session.userId,
      });
      check(error);
      if (typeof data !== "string") throw new Error("PC pairing session was not created");
      return data;
    },
    async claimSession(codeHash, claim) {
      const { data, error } = await db.rpc("claim_pc_pairing", {
        p_code_hash: codeHash, p_fingerprint: claim.fingerprint,
        p_public_key: claim.publicKey, p_name: claim.name,
      });
      check(error);
      return data === true;
    },
    async peekClaim(userId, pairingId, now) {
      const { data, error } = await db.from("pc_pairing_sessions").select()
        .eq("pairing_id", pairingId).eq("user_id", userId)
        .not("claimed_at", "is", null).is("consumed_at", null)
        .gt("expires_at", now).maybeSingle();
      check(error);
      return data ? sessionFromRow(data) : null;
    },
    async completeClaim(userId, pairingId) {
      const { data, error } = await db.rpc("complete_pc_pairing", {
        p_user_id: userId, p_pairing_id: pairingId,
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
    async revokeDevice(userId, id) {
      const { data, error } = await db.rpc("revoke_pc_device", {
        p_user_id: userId, p_device_id: id,
      });
      check(error);
      return data === true;
    },
  };
}
