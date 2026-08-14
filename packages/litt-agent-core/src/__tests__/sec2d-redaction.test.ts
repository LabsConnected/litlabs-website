/**
 * SEC-2D — Audit-safe redaction guarantees.
 *
 * Tests that the redaction utilities correctly strip secret material
 * from arbitrary objects before they enter audit logs, events, model
 * context, or serialized state.
 *
 * Also verifies the compile-time schema checks on CredentialAuditEvent.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED,
  redactString,
  redactForAudit,
  type CredentialAuditEvent,
  type CredentialLease,
} from "../contracts/index.js";

const SUPER_SECRET_DO_NOT_LEAK_123 = "SUPER_SECRET_DO_NOT_LEAK_123";

describe("SEC-2D — Audit-safe redaction", () => {

  describe("redactString", () => {
    it("redacts OpenAI-style API keys (sk-...)", () => {
      const input = "the key is sk-1234567890abcdefghijklmnopqrstuvwxyz";
      const redacted = redactString(input);
      assert.ok(!redacted.includes("sk-1234567890abcdefghijklmnopqrstuvwxyz"));
      assert.ok(redacted.includes(REDACTED));
    });

    it("redacts GitHub PATs (ghp_...)", () => {
      const input = "token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890";
      const redacted = redactString(input);
      assert.ok(!redacted.includes("ghp_"));
      assert.ok(redacted.includes(REDACTED));
    });

    it("redacts Bearer tokens", () => {
      const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const redacted = redactString(input);
      assert.ok(!redacted.includes("Bearer eyJ"));
      assert.ok(redacted.includes(REDACTED));
    });

    it("redacts AWS access keys (AKIA...)", () => {
      const input = "aws_key: AKIAIOSFODNN7EXAMPLE";
      const redacted = redactString(input);
      assert.ok(!redacted.includes("AKIAIOSFODNN7EXAMPLE"));
      assert.ok(redacted.includes(REDACTED));
    });

    it("does not redact normal text", () => {
      const input = "this is a normal string with no secrets";
      const redacted = redactString(input);
      assert.equal(redacted, input);
    });

    it("does not redact the test secret (it's not a known pattern — defense in depth)", () => {
      // SUPER_SECRET_DO_NOT_LEAK_123 does not match any known secret pattern.
      // This is expected — redactString is pattern-based defense-in-depth.
      // The PRIMARY protection is that the broker never exposes secrets.
      const redacted = redactString(SUPER_SECRET_DO_NOT_LEAK_123);
      // It won't be redacted by pattern matching, but it should never
      // appear in audit surfaces because the broker doesn't expose it.
      assert.equal(redacted, SUPER_SECRET_DO_NOT_LEAK_123);
    });
  });

  describe("redactForAudit", () => {
    it("redacts values of keys with secret-sounding names", () => {
      const input = {
        provider: "github",
        apiKey: "sk-1234567890abcdefghijklmnopqrstuvwxyz",
        secret: "my-secret-value",
        token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890",
        normalField: "normal-value",
      };
      const redacted = redactForAudit(input);

      assert.equal(redacted.apiKey, REDACTED);
      assert.equal(redacted.secret, REDACTED);
      assert.equal(redacted.token, REDACTED);
      assert.equal(redacted.normalField, "normal-value");
      assert.equal(redacted.provider, "github");
    });

    it("redacts nested objects recursively", () => {
      const input = {
        outer: {
          inner: {
            password: "hunter2",
            data: "normal",
          },
        },
        list: [
          { apiKey: "sk-1234567890abcdefghijklmnopqrstuvwxyz" },
          { name: "item2" },
        ],
      };
      const redacted = redactForAudit(input);

      assert.equal(redacted.outer.inner.password, REDACTED);
      assert.equal(redacted.outer.inner.data, "normal");
      assert.equal(redacted.list[0].apiKey, REDACTED);
      assert.equal(redacted.list[1].name, "item2");
    });

    it("does not mutate the input object", () => {
      const input = { apiKey: "sk-1234567890abcdefghijklmnopqrstuvwxyz", name: "test" };
      const original = { ...input };
      redactForAudit(input);

      assert.equal(input.apiKey, original.apiKey);
      assert.equal(input.name, original.name);
    });

    it("handles null and undefined", () => {
      assert.equal(redactForAudit(null), null);
      assert.equal(redactForAudit(undefined), undefined);
    });

    it("handles primitives", () => {
      assert.equal(redactForAudit(42), 42);
      assert.equal(redactForAudit(true), true);
    });

    it("redacts snake_case secret key names", () => {
      const input = {
        api_key: "sk-1234567890abcdefghijklmnopqrstuvwxyz",
        access_token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890",
        client_secret: "secret-value",
      };
      const redacted = redactForAudit(input);

      assert.equal(redacted.api_key, REDACTED);
      assert.equal(redacted.access_token, REDACTED);
      assert.equal(redacted.client_secret, REDACTED);
    });
  });

  describe("CredentialAuditEvent schema safety", () => {
    it("CredentialAuditEvent does not have forbidden secret fields (compile-time)", () => {
      // The _AuditSchemaCheck type in credential.ts enforces this at compile time.
      // If this file compiles, the schema is safe.
      const event: CredentialAuditEvent = {
        eventId: "evt-1",
        timestamp: new Date().toISOString(),
        operation: "resolve",
        provider: "github",
        runId: "run-1",
        actorId: "user:1",
        capabilityGrantId: "grant-1",
        outcome: "allowed",
        reason: null,
        leaseId: "lease-1",
      };

      // Verify no secret fields exist
      const asRecord = event as unknown as Record<string, unknown>;
      assert.equal(asRecord.apiKey, undefined);
      assert.equal(asRecord.secret, undefined);
      assert.equal(asRecord.token, undefined);
      assert.equal(asRecord.password, undefined);
    });

    it("CredentialLease remains schema-safe after SEC-2B changes", () => {
      const lease: CredentialLease = {
        leaseId: "lease-1",
        provider: "github",
        runId: "run-1",
        actorId: "user:1",
        capabilityGrantId: "grant-1",
        scopes: ["repo:read"],
        resourceScope: ["workspace:ws-1"],
        audience: "github.com",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        renewable: true,
        origin: "byok",
        secretRef: "broker://github/abc/lease-1",
      };

      const asRecord = lease as unknown as Record<string, unknown>;
      assert.equal(asRecord.apiKey, undefined);
      assert.equal(asRecord.secret, undefined);
      assert.equal(asRecord.token, undefined);
      assert.equal(asRecord.password, undefined);
    });
  });

  describe("Defense-in-depth: redaction catches what broker might miss", () => {
    it("redactForAudit applied to a full audit event with accidentally embedded secret", () => {
      // Simulate a bug where a secret accidentally ends up in a reason field
      const buggyEvent = {
        eventId: "evt-1",
        timestamp: new Date().toISOString(),
        operation: "resolve" as const,
        provider: "github",
        runId: "run-1",
        actorId: "user:1",
        capabilityGrantId: "grant-1",
        outcome: "error" as const,
        reason: `failed to authenticate with key: sk-1234567890abcdefghijklmnopqrstuvwxyz`,
        leaseId: null,
      };

      const redacted = redactForAudit(buggyEvent);
      assert.ok(!redacted.reason.includes("sk-1234567890"));
      assert.ok(redacted.reason.includes(REDACTED));
    });

    it("redactForAudit applied to an object with a 'credential' key", () => {
      const input = {
        operation: "materialize",
        credential: "some-secret-value-that-should-not-be-here",
        status: "ok",
      };
      const redacted = redactForAudit(input);
      assert.equal(redacted.credential, REDACTED);
    });
  });
});
