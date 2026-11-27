import "server-only";
import { getSupabaseAdmin } from "./supabase";
import { createPcPairingStore } from "./pc-pairing-db";
import { PcPairingService } from "./pc-pairing";

export function getPcPairingService(): PcPairingService | null {
  const admin = getSupabaseAdmin();
  return admin ? new PcPairingService(createPcPairingStore(admin)) : null;
}
