// scripts/mock-outbound-call-test.mjs
// Run: DEX_BRIDGE_SECRET=$(node -e "console.log('x'.repeat(32))") node scripts/mock-outbound-call-test.mjs
// Optional: DEX_TEST_PORT=3500 if your local dev server runs on a non-default port.
// Exercises the full Dex -> call-request -> authorization chain against a
// local dev server. Makes zero network calls to Twilio or any real carrier.
import { createHmac } from "node:crypto";

const secret = process.env.DEX_BRIDGE_SECRET;
if (!secret || secret.length < 32) {
  console.error("Set DEX_BRIDGE_SECRET (>=32 chars) matching your local .env before running.");
  process.exit(1);
}

const port = process.env.DEX_TEST_PORT || "3000";
const body = JSON.stringify({ phone: "+15551234567", requestedBy: "dex-mock-test", estimatedCostCents: 0 });
const sig = createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(`http://localhost:${port}/api/dex/call-request`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-dex-signature": sig },
  body,
});
const json = await res.json();
console.log(`Status: ${res.status}`);
console.log(JSON.stringify(json, null, 2));

if (res.status === 403 && json.allowed === false) {
  console.log("\nPASS (expected): Phase 1 repo denies by default — kill switch engaged, no call placed.");
} else if (res.status === 202 && json.allowed === true) {
  console.log("\nPASS: request authorized, MockTwilioProvider returned a queued (non-real) call.");
} else {
  console.error("\nUNEXPECTED RESPONSE — investigate before treating this as a passing mock test.");
  process.exit(1);
}
