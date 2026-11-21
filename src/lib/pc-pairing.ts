import { createHash, randomBytes, randomUUID } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{12}$/;
const CODE_TTL_MS = 10 * 60_000;
const PAIRING_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(`litt-pair:${code}`).digest("hex");
}

export function fingerprintForPublicKey(publicKey: string): string {
  return createHash("sha256").update(`litt-local-device:${publicKey}`).digest("hex");
}

function validClaim(claim: { fingerprint: string; publicKey: string; name: string }): boolean {
  return claim.publicKey.length <= 4096 &&
    claim.publicKey.includes("BEGIN PUBLIC KEY") &&
    /^[0-9a-f]{64}$/.test(claim.fingerprint) &&
    fingerprintForPublicKey(claim.publicKey) === claim.fingerprint &&
    claim.name.trim().length > 0 && claim.name.trim().length <= 80;
}

export interface PairingSession {
  pairingId: string;
  codeHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  consumedAt: string | null;
  fingerprint: string | null;
  publicKey: string | null;
  name: string | null;
}

export interface PairedPc {
  id: string;
  userId: string;
  fingerprint: string;
  publicKey: string;
  name: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface PairingStore {
  createSession(session: PairingSession): Promise<string>;
  claimSession(codeHash: string, claim: { fingerprint: string; publicKey: string; name: string }, now: string): Promise<boolean>;
  peekClaim(userId: string, pairingId: string, now: string): Promise<PairingSession | null>;
  completeClaim(userId: string, pairingId: string, now: string): Promise<PairedPc | null>;
  listDevices(userId: string): Promise<PairedPc[]>;
  revokeDevice(userId: string, id: string, now: string): Promise<boolean>;
}

export class PcPairingService {
  constructor(private readonly store: PairingStore, private readonly clock: () => Date = () => new Date()) {}
  async createCode(userId: string): Promise<{ code: string; pairingId: string; expiresAt: string }> {
    if (!userId) throw new Error("Signed-in user required");
    const bytes = randomBytes(12);
    const code = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
    const pairingId = randomUUID();
    const createdAt = this.clock().toISOString();
    const expiresAt = new Date(this.clock().getTime() + CODE_TTL_MS).toISOString();
    const storedExpiresAt = await this.store.createSession({
      pairingId, codeHash: hashPairingCode(code), userId, createdAt, expiresAt,
      claimedAt: null, consumedAt: null, fingerprint: null, publicKey: null, name: null,
    });
    return { code, pairingId, expiresAt: storedExpiresAt };
  }

  async claimFromAgent(code: string, claim: { fingerprint: string; publicKey: string; name: string }): Promise<boolean> {
    if (!CODE_PATTERN.test(code) || !validClaim(claim)) return false;
    return this.store.claimSession(hashPairingCode(code), { ...claim, name: claim.name.trim() }, this.clock().toISOString());
  }

  async completePairing(userId: string, pairingId: string): Promise<PairedPc | null> {
    if (!userId || !PAIRING_ID_PATTERN.test(pairingId)) return null;
    return this.store.completeClaim(userId, pairingId, this.clock().toISOString());
  }

  async peekClaim(userId: string, pairingId: string): Promise<{ fingerprint: string; name: string } | null> {
    if (!userId || !PAIRING_ID_PATTERN.test(pairingId)) return null;
    const session = await this.store.peekClaim(userId, pairingId, this.clock().toISOString());
    if (!session || session.userId !== userId || !session.fingerprint || !session.publicKey || !session.name) return null;
    const claim = { fingerprint: session.fingerprint, publicKey: session.publicKey, name: session.name };
    return validClaim(claim) ? { fingerprint: claim.fingerprint, name: claim.name } : null;
  }

  async listDevices(userId: string): Promise<PairedPc[]> {
    if (!userId) return [];
    return this.store.listDevices(userId);
  }

  async revokeDevice(userId: string, id: string): Promise<boolean> {
    if (!userId || !id) return false;
    return this.store.revokeDevice(userId, id, this.clock().toISOString());
  }
}
