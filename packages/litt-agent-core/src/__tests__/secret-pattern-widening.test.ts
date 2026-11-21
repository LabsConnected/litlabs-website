/**
 * Secret-pattern widening — regression tests for the two redactors:
 *   - contracts/credential.ts  redactString() / redactForAudit()
 *   - execution.ts             redactSecrets()
 *
 * Modern key formats put `_` or `-` inside the key body (sk-proj-…,
 * sk-or-v1-…, pk_live_…, sk_live_…). The previous patterns stopped at the
 * first separator, so these keys were either missed entirely or only
 * partially masked.
 *
 * Every "key" below is assembled at runtime from obviously fake filler so
 * no token-shaped literal lives in the source (keeps secret scanners quiet).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { redactString, redactForAudit, REDACTED } from "../contracts/credential.js";
import { redactSecrets } from "../execution.js";

const FILL = "FAKE0fake1FAKE2fake3FAKE4fake5";
const key = (prefix: string) => prefix + FILL;

const SHAPES: Record<string, string> = {
  "OpenAI project key (sk-proj-…)": key("sk-proj-"),
  "OpenRouter key (sk-or-v1-…)": key("sk-or-v1-"),
  "underscore body (sk-…_…)": "sk-" + FILL.slice(0, 12) + "_" + FILL.slice(12),
  "Stripe publishable (pk_live_…)": key("pk_live_"),
  "Stripe publishable (pk_test_…)": key("pk_test_"),
  "Stripe secret (sk_live_…)": key("sk_live_"),
  "Stripe restricted (rk_test_…)": key("rk_test_"),
};

function assertFullyMasked(out: string, secret: string, label: string): void {
  assert.ok(out.includes(REDACTED), `${label}: no redaction marker in ${JSON.stringify(out)}`);
  assert.ok(!out.includes(FILL.slice(-12)), `${label}: key tail leaked in ${JSON.stringify(out)}`);
  assert.ok(!out.includes(secret), `${label}: raw key leaked`);
}

describe("credential.ts redactString — widened key shapes", () => {
  for (const [label, secret] of Object.entries(SHAPES)) {
    test(label, () => {
      assertFullyMasked(redactString(`export TOKEN_X=${secret} && run`), secret, label);
    });
  }

  test("redactForAudit masks a widened key nested in an object", () => {
    const secret = SHAPES["OpenAI project key (sk-proj-…)"];
    const out = redactForAudit({ args: ["curl", "-d", secret], note: "plain" });
    assert.equal(out.args[2], REDACTED);
    assert.equal(out.note, "plain");
  });

  test("ordinary text with sk-/pk_ prefixes but no key body is untouched", () => {
    const text = "use sk-learn and pk_id columns; ask-me-later";
    assert.equal(redactString(text), text);
  });
});

describe("execution.ts redactSecrets — widened key shapes", () => {
  for (const [label, secret] of Object.entries(SHAPES)) {
    test(label, () => {
      assertFullyMasked(redactSecrets(`curl -H "x: ${secret}" https://example.invalid`), secret, label);
    });
  }

  test("ordinary text with sk-/pk_ prefixes but no key body is untouched", () => {
    const text = "use sk-learn and pk_id columns; ask-me-later";
    assert.equal(redactSecrets(text), text);
  });
});
