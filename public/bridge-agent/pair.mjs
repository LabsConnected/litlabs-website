#!/usr/bin/env node
// One-shot, pairing-only PC client. No host execution or persistent relay.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export function loadIdentity(root = process.env.BRIDGE_KEY_ROOT || process.env.LITT_DEVICE_KEY_ROOT ||
  (existsSync(join(process.cwd(), ".litt-device-key.json")) ? process.cwd() : join(homedir(), ".litt-bridge", "keys"))) {
  const file = join(root, ".litt-device-key.json");
  if (existsSync(file)) {
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    const privateKey = createPrivateKey(persisted.privateKey);
    const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
    if (privateKey.asymmetricKeyType !== "ed25519" || publicKey !== persisted.publicKey)
      throw new Error("Existing device key is invalid. Restore the key file; it was not replaced.");
    return { privateKey, publicKey };
  }
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pair), { flag: "wx", mode: 0o600 });
  return { privateKey: createPrivateKey(pair.privateKey), publicKey: pair.publicKey };
}

export function signedClaim(code, name, identity) {
  const fingerprint = createHash("sha256").update(`litt-local-device:${identity.publicKey}`).digest("hex");
  const message = Buffer.from(JSON.stringify(["litt-pc-pair-v1", code, fingerprint, name]), "utf8");
  return {
    code, name, fingerprint, publicKey: identity.publicKey,
    signature: sign(null, message, identity.privateKey).toString("base64"),
  };
}

async function main() {
  const appUrl = process.argv[2];
  if (!appUrl) throw new Error("Usage: node litt-pair.mjs https://<your LiTT app> [--key-root <existing key folder>]");
  const base = new URL(appUrl);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
    throw new Error("Pairing requires HTTPS (or localhost for development)");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let code;
  try { code = (await rl.question("Code shown in Connect PC: ")).trim().toUpperCase(); }
  finally { rl.close(); }
  if (!/^[A-HJKMNP-Z2-9]{12}$/.test(code)) throw new Error("Invalid pairing code");
  const keyRootFlag = process.argv.indexOf("--key-root");
  if (keyRootFlag >= 0 && !process.argv[keyRootFlag + 1]) throw new Error("--key-root requires a folder");
  const identity = loadIdentity(keyRootFlag >= 0 ? process.argv[keyRootFlag + 1] : undefined);
  const response = await fetch(new URL("/api/local-devices/pairing/device-claim", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedClaim(code, hostname().slice(0, 80), identity)),
  });
  if (response.status !== 202) throw new Error(`Pairing claim refused (${response.status}). Generate a fresh code and retry.`);
  console.log("Claim sent. Check the device name and fingerprint in Connect PC, then confirm there.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
