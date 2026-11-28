# Delivery priorities

| Priority | Deliverable and dependency | Exit gate |
|---|---|---|
| P0 | Review the source audit, evidence ledger and kernel/host boundaries. Choose the initial shared run fixture. | Each proposed migration maps to an existing owner and a reproducible check or an explicit evidence gap. |
| P1 | Carry native model deltas, abort signals and provider identity through the CLI and Desktop adapters. Introduce headless JSON/JSONL on the existing run path. | A1–A3. A real model turn and the headless consumer agree on the final answer. |
| P2 | Bind Ink activity, summaries, approvals, usage and duration to run events. Extend composer, code rendering and attachments. | A4. |
| P3 | Reuse Chat browser handlers and session ownership. Expose navigation, citations, extraction, takeover and artifact references in the CLI. | A5. |
| P4 | Extend scoped coding jobs from repair and missions. Add verified checkpoints, bounded delegation and capability-scoped computer adapters. | A6. |
| P5 | Adapt workspace transport to the existing gateway, then migrate Chat, Studio and PocketOS clients incrementally. Include media and sandbox capability discovery. | A7. |
| P6 | Connect conversation and memory stores, reuse the existing automation trigger infrastructure and persist job identity across restart. | A8. |
| P7 | Measure startup, context retrieval, resource consumption and PC-backed inference on each target. | A9. |

P1 establishes the event and cancellation contracts consumed by later work. P3 and P4 can characterize adapters locally. Enable them on another surface only after the P5 authority checks pass there. Each release records the exact commit, invocation, provider, platform and limitations alongside results.
