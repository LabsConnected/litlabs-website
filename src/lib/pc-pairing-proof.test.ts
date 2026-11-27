import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintForPublicKey } from "./pc-pairing";
import { pcClaimMessage, verifyPcClaim } from "./pc-pairing-proof";

describe("signed PC claim", () => {
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const base = { code: "ABCDEFGHJKMN", publicKey: keys.publicKey,
    fingerprint: fingerprintForPublicKey(keys.publicKey), name: "Office PC" };
  const signature = sign(null, pcClaimMessage(base), keys.privateKey).toString("base64");

  it("requires possession of the matching Ed25519 private key", () => {
    expect(verifyPcClaim({ ...base, signature })).toBe(true);
    expect(verifyPcClaim({ ...base, name: "Imposter", signature })).toBe(false);
    expect(verifyPcClaim({ ...base, code: "ABCDEFGHJKMP", signature })).toBe(false);
    expect(verifyPcClaim({ ...base, fingerprint: "0".repeat(64), signature })).toBe(false);
    expect(verifyPcClaim({ ...base, signature: "AA==" })).toBe(false);
  });
});
