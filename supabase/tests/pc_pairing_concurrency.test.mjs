// CI-only integration test. The fixed loopback URL prevents accidental use on production.
import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

const localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { Client } = pg;

test("pairing claims and revocation serialize across database connections", { timeout: 30_000 }, async () => {
  const clients = Array.from({ length: 3 }, () => new Client({ connectionString: localDatabaseUrl }));
  await Promise.all(clients.map((client) => client.connect()));
  const [admin, first, second] = clients;
  const owner = `pairing-ci-${randomUUID()}`;
  const otherOwner = `pairing-ci-${randomUUID()}`;
  const fingerprint = randomBytes(32).toString("hex");
  const codeHash = () => randomBytes(32).toString("hex");
  const initialCode = codeHash();
  const initialId = randomUUID();
  try {
    await admin.query("SELECT public.issue_pc_pairing($1,$2,$3)", [owner, initialCode, initialId]);
    const claims = await Promise.all([first, second].map((client) =>
      client.query("SELECT public.claim_pc_pairing($1,$2,$3,$4) AS accepted",
        [initialCode, fingerprint, "test-public-key", "PC"])));
    assert.deepEqual(claims.map((result) => result.rows[0].accepted).sort(), [false, true]);
    const paired = await admin.query("SELECT id FROM public.complete_pc_pairing($1,$2)", [owner, initialId]);
    assert.equal(paired.rowCount, 1);
    const deviceId = paired.rows[0].id;

    const pendingCode = codeHash();
    const pendingId = randomUUID();
    await admin.query("SELECT public.issue_pc_pairing($1,$2,$3)", [owner, pendingCode, pendingId]);
    const pending = await admin.query("SELECT public.claim_pc_pairing($1,$2,$3,$4) AS accepted",
      [pendingCode, fingerprint, "test-public-key", "PC"]);
    assert.equal(pending.rows[0].accepted, true);

    await Promise.all([
      first.query("SELECT public.revoke_pc_device($1,$2)", [owner, deviceId]),
      second.query("SELECT id FROM public.complete_pc_pairing($1,$2)", [owner, pendingId]),
    ]);
    const afterRace = await admin.query("SELECT revoked_at FROM public.local_devices WHERE id=$1", [deviceId]);
    assert.ok(afterRace.rows[0].revoked_at, "revocation must win or follow confirmation");
    const replay = await admin.query("SELECT id FROM public.complete_pc_pairing($1,$2)", [owner, pendingId]);
    assert.equal(replay.rowCount, 0);

    const freshCode = codeHash();
    const freshId = randomUUID();
    await admin.query("SELECT public.issue_pc_pairing($1,$2,$3)", [owner, freshCode, freshId]);
    const freshClaim = await admin.query("SELECT public.claim_pc_pairing($1,$2,$3,$4) AS accepted",
      [freshCode, fingerprint, "test-public-key", "PC"]);
    assert.equal(freshClaim.rows[0].accepted, true);
    const restored = await admin.query("SELECT id, revoked_at FROM public.complete_pc_pairing($1,$2)",
      [owner, freshId]);
    assert.equal(restored.rows[0].id, deviceId);
    assert.equal(restored.rows[0].revoked_at, null);

    const foreignCode = codeHash();
    await admin.query("SELECT public.issue_pc_pairing($1,$2,$3)", [otherOwner, foreignCode, randomUUID()]);
    const foreignClaim = await admin.query("SELECT public.claim_pc_pairing($1,$2,$3,$4) AS accepted",
      [foreignCode, fingerprint, "test-public-key", "PC"]);
    assert.equal(foreignClaim.rows[0].accepted, false);
  } finally {
    await admin.query("DELETE FROM public.pc_pairing_sessions WHERE user_id IN ($1,$2)", [owner, otherOwner]);
    await admin.query("DELETE FROM public.local_devices WHERE user_id=$1", [owner]);
    await Promise.all(clients.map((client) => client.end()));
  }
});
