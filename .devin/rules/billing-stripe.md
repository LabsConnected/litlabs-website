---
description: "Billing and Stripe rules — apply when touching payments, subscriptions, webhooks, or plan gating"
trigger: model_decision
---

# Billing & Stripe

- Treat billing state as server-authoritative; never unlock paid functionality based solely on client state.
- Verify Stripe webhook signatures; make webhook processing idempotent.
- Do not expose Stripe secrets client-side; clearly distinguish test-mode and live-mode behavior.
- Never fake successful payment/subscription states.
