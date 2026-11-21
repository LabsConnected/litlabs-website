import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verify } from "node:crypto";
import { hardenWindowsKeyFile, loadIdentity, signedClaim } from "../public/bridge-agent/pair.mjs";

test("re-pair retains the same key and signs the owner-visible claim", () => {
  const root = mkdtempSync(join(tmpdir(), "litt-pc-key-"));
  const first = loadIdentity(root);
  const second = loadIdentity(root);
  assert.equal(first.publicKey, second.publicKey);
  process.env.BRIDGE_KEY_ROOT = root;
  try { assert.equal(loadIdentity().publicKey, first.publicKey); }
  finally { delete process.env.BRIDGE_KEY_ROOT; }
  const claim = signedClaim("ABCDEFGHJKMN", "Office PC", second);
  const payload = Buffer.from(JSON.stringify(["litt-pc-pair-v1", claim.code, claim.fingerprint, claim.name]));
  assert.equal(verify(null, payload, claim.publicKey, Buffer.from(claim.signature, "base64")), true);
  const file = join(root, ".litt-device-key.json");
  writeFileSync(file, readFileSync(file, "utf8").replace("BEGIN PRIVATE KEY", "BEGIN BROKEN KEY"));
  assert.throws(() => loadIdentity(root));
  assert.match(readFileSync(file, "utf8"), /BEGIN BROKEN KEY/);
});

test("hardenWindowsKeyFile is a no-op off Windows and never touches the file's bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "litt-pc-key-"));
  loadIdentity(root);
  const file = join(root, ".litt-device-key.json");
  const before = readFileSync(file, "utf8");
  if (process.platform !== "win32") {
    assert.doesNotThrow(() => hardenWindowsKeyFile(file));
  }
  assert.equal(readFileSync(file, "utf8"), before);
});

test("a freshly created key file on Windows loses inherited ACEs and is scoped to the current user",
  { skip: process.platform !== "win32" }, () => {
    const root = mkdtempSync(join(tmpdir(), "litt-pc-key-"));
    loadIdentity(root);
    const file = join(root, ".litt-device-key.json");
    const system32 = join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32");
    const acl = execFileSync(join(system32, "icacls.exe"), [file], { encoding: "utf8" });
    assert.doesNotMatch(acl, /\(I\)/, "no inherited ACEs should remain");
    const who = execFileSync(join(system32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
    const account = who.trim().replace(/\r/g, "").split(",")[0].replace(/"/g, "").trim();
    assert.ok(acl.toLowerCase().includes(account.toLowerCase()), `ACL should grant the current user (${account})`);
  });

test("re-applying the hardening to an already-restricted key is safe and idempotent",
  { skip: process.platform !== "win32" }, () => {
    const root = mkdtempSync(join(tmpdir(), "litt-pc-key-"));
    loadIdentity(root);
    const file = join(root, ".litt-device-key.json");
    const before = readFileSync(file, "utf8");
    assert.doesNotThrow(() => hardenWindowsKeyFile(file));
    const system32 = join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32");
    const acl = execFileSync(join(system32, "icacls.exe"), [file], { encoding: "utf8" });
    assert.doesNotMatch(acl, /\(I\)/, "ACL should still have no inherited ACEs after a second pass");
    assert.equal(readFileSync(file, "utf8"), before, "re-applying ACLs must never touch the key's bytes");
  });

test("hardenWindowsKeyFile fails safe (warns, never throws) when the target cannot be touched", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "litt-pc-key-")), "does-not-exist", ".litt-device-key.json");
  const originalError = console.error;
  let warned = false;
  console.error = () => { warned = true; };
  try {
    assert.doesNotThrow(() => hardenWindowsKeyFile(missing));
  } finally {
    console.error = originalError;
  }
  if (process.platform === "win32") assert.ok(warned, "a failed hardening attempt must surface a warning, not fail silently");
});
