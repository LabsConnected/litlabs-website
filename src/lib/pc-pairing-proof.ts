import { createPublicKey, verify } from "node:crypto";
import { fingerprintForPublicKey } from "./pc-pairing";

export interface SignedPcClaim {
  code: string;
  publicKey: string;
  fingerprint: string;
  name: string;
  signature: string;
}

export function pcClaimMessage(claim: Pick<SignedPcClaim, "code" | "fingerprint" | "name">): Buffer {
  return Buffer.from(JSON.stringify(["litt-pc-pair-v1", claim.code, claim.fingerprint, claim.name]), "utf8");
}

export function verifyPcClaim(claim: SignedPcClaim): boolean {
  try {
    if (!/^[A-HJKMNP-Z2-9]{12}$/.test(claim.code) ||
        !/^[0-9a-f]{64}$/.test(claim.fingerprint) ||
        claim.name.trim() !== claim.name || claim.name.length < 1 || claim.name.length > 80 ||
        claim.publicKey.length > 4096 || claim.signature.length > 256 ||
        fingerprintForPublicKey(claim.publicKey) !== claim.fingerprint) return false;
    const key = createPublicKey(claim.publicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(claim.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== claim.signature) return false;
    return verify(null, pcClaimMessage(claim), key, signature);
  } catch {
    return false;
  }
}
