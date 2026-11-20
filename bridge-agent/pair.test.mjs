import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verify } from "node:crypto";
import { loadIdentity, signedClaim } from "../public/bridge-agent/pair.mjs";

test("re-pair retains the same key and signs the owner-visible claim", () => {
  const root = mkdtempSync(join(tmpdir(), "litt-pc-key-"));
  const first = loadIdentity(root);
  const second = loadIdentity(root);
  assert.equal(first.publicKey, second.publicKey);
  const claim = signedClaim("ABCDEFGHJKMN", "Office PC", second);
  const payload = Buffer.from(JSON.stringify(["litt-pc-pair-v1", claim.code, claim.fingerprint, claim.name]));
  assert.equal(verify(null, payload, claim.publicKey, Buffer.from(claim.signature, "base64")), true);
  const file = join(root, ".litt-device-key.json");
  writeFileSync(file, readFileSync(file, "utf8").replace("BEGIN PRIVATE KEY", "BEGIN BROKEN KEY"));
  assert.throws(() => loadIdentity(root));
  assert.match(readFileSync(file, "utf8"), /BEGIN BROKEN KEY/);
});
