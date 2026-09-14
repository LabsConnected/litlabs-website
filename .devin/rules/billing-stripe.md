---
description: "Billing and Stripe rules — apply when touching payments, subscriptions, webhooks, or plan gating"
trigger: model_decision
---

# Billing & Stripe

- Treat billing state as server-authoritative.
- Never unlock paid functionality based solely on client state.
- Verify Stripe webhook signatures.
- Make webhook processing idempotent.
- Do not expose Stripe secrets client-side.
- Clearly distinguish test-mode and live-mode behavior.
- Never fake successful payment/subscription states.
