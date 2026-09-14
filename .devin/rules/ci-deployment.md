---
description: "CI, merge-gate, and deployment rules for all integration work in this repo"
trigger: always_on
---

# CI & Deployment

- Treat GitHub CI as authoritative for full validation.
- Do not merge while required checks are failing.
- Review failed checks before retrying blindly.
- Never bypass required checks merely to ship faster.
- Ensure deploy state corresponds to the intended commit.
- Confirm migrations and environment requirements before production deployment.
- Do not deploy from an unknown, dirty, or partially merged state.
