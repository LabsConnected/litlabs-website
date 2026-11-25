import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const base = "https://terminal-server-staging.up.railway.app";
const required = [
  "EXPECTED_STAGING_SHA",
  "STAGING_TERMINAL_WORKSPACE_ID",
  "STAGING_TERMINAL_OWNER_USER_ID",
  "STAGING_TERMINAL_EXISTING_FILE",
  "STAGING_TERMINAL_EXISTING_SHA256",
  "STAGING_TERMINAL_INTERNAL_SERVICE_KEY",
];
for (const name of required) {
  assert(process.env[name], name + " is required");
}
assert(/^[0-9a-f]{40}$/.test(process.env.EXPECTED_STAGING_SHA), "Expected full lowercase release SHA");
assert(/^[0-9a-f]{64}$/.test(process.env.STAGING_TERMINAL_EXISTING_SHA256), "Expected file SHA-256");
assert(process.env.STAGING_TERMINAL_INTERNAL_SERVICE_KEY.length >= 32, "Internal key is too short");
assert(
  Boolean(process.env.STAGING_TERMINAL_JWT) !== Boolean(process.env.STAGING_TERMINAL_OWNER_CLERK_JWT),
  "Provide exactly one short-lived owner JWT: terminal or Clerk"
);

async function request(path, options = {}, timeoutMs = 20_000) {
  const response = await fetch(base + path, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(path + " returned non-JSON HTTP " + response.status);
  }
  return { status: response.status, body };
}

function assertHealth(body) {
  assert.equal(body.status, "ok");
  assert.equal(body.readiness, "ready");
  assert.equal(body.commit, process.env.EXPECTED_STAGING_SHA.slice(0, 8));
  assert.equal(body.terminal?.sandbox?.execution, "enabled");
  assert.equal(body.terminal?.sandbox?.state, "verified");
  assert.equal(body.terminal?.execution, "disabled");
  assert.equal(body.terminal?.mode, "none");
}

const before = await request("/health");
assert.equal(before.status, 200);
assertHealth(before.body);

let terminalJwt = process.env.STAGING_TERMINAL_JWT;
if (!terminalJwt) {
  const exchange = await request("/api/token-exchange", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.STAGING_TERMINAL_OWNER_CLERK_JWT },
    body: JSON.stringify({ workspaceId: process.env.STAGING_TERMINAL_WORKSPACE_ID }),
  });
  assert.equal(exchange.status, 200, "Owner token exchange failed");
  terminalJwt = exchange.body.terminalToken;
  assert(terminalJwt, "Token exchange returned no terminal JWT");
}
const auth = {
  authorization: "Bearer " + terminalJwt,
  "x-workspace-id": process.env.STAGING_TERMINAL_WORKSPACE_ID,
};
const fileBody = JSON.stringify({ path: process.env.STAGING_TERMINAL_EXISTING_FILE, encoding: "utf-8" });
const deniedRead = await request("/ws-files/read", { method: "POST", body: fileBody, headers: {
  "x-workspace-id": process.env.STAGING_TERMINAL_WORKSPACE_ID,
}});
assert.equal(deniedRead.status, 401, "Unauthenticated file read was accepted");

const existing = await request("/ws-files/read", { method: "POST", body: fileBody, headers: auth });
assert.equal(existing.status, 200, "Authenticated existing-file read failed");
assert.equal(existing.body.encoding, "utf-8");
assert.equal(existing.body.workspaceId, process.env.STAGING_TERMINAL_WORKSPACE_ID);
const fileHash = createHash("sha256").update(existing.body.content, "utf8").digest("hex");
assert.equal(fileHash, process.env.STAGING_TERMINAL_EXISTING_SHA256, "Existing file content changed");

const missingName = "__litt_smoke_missing_" + randomUUID() + ".txt";
const missing = await request("/ws-files/read", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ path: missingName, encoding: "utf-8" }),
});
assert.equal(missing.status, 404, "Missing-file read did not return 404");
assert.equal(missing.body.error, "File not found", "Missing-file response disclosed a path or raw error");

const marker = "LITT_SANDBOX_SMOKE_" + randomUUID().replaceAll("-", "");
const isolated = await request("/internal/workspace/" +
  encodeURIComponent(process.env.STAGING_TERMINAL_WORKSPACE_ID) + "/exec", {
  method: "POST",
  headers: { "x-internal-service-key": process.env.STAGING_TERMINAL_INTERNAL_SERVICE_KEY },
  body: JSON.stringify({
    userId: process.env.STAGING_TERMINAL_OWNER_USER_ID,
    command: "printf " + marker,
  }),
}, 150_000);
assert.equal(isolated.status, 200, "Isolated workspace command failed");
assert.equal(isolated.body.exitCode, 0);
assert.equal(isolated.body.stdout, marker);
assert.equal(isolated.body.policyEffect, "sandbox_exec");
assert.match(isolated.body.runId, /^sandbox:/);

const hostMarker = "LITT_HOST_DENIAL_" + randomUUID().replaceAll("-", "");
const host = await request("/api/command", {
  method: "POST",
  headers: { authorization: "Bearer " + terminalJwt },
  body: JSON.stringify({
    command: "/do",
    args: ["printf", hostMarker],
    workspaceId: process.env.STAGING_TERMINAL_WORKSPACE_ID,
  }),
});
assert.equal(host.status, 503, "Host command was not denied");
assert.equal(host.body.code, "HOST_EXECUTION_DISABLED");
assert(!JSON.stringify(host.body).includes(hostMarker), "Host command output appeared in denial response");

const after = await request("/health");
assert.equal(after.status, 200);
assertHealth(after.body);
console.log(JSON.stringify({
  result: "PASS",
  expectedSha: process.env.EXPECTED_STAGING_SHA,
  runtimeCommit: after.body.commit,
  workspaceId: process.env.STAGING_TERMINAL_WORKSPACE_ID,
  existingFileSha256: fileHash,
  unauthenticatedReadStatus: deniedRead.status,
  existingReadStatus: existing.status,
  missingReadStatus: missing.status,
  isolatedExecStatus: isolated.status,
  isolatedPolicyEffect: isolated.body.policyEffect,
  hostExecStatus: host.status,
  hostExecCode: host.body.code,
  verifiedAt: new Date().toISOString(),
}));
