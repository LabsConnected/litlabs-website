# LiTT CLI Next-Generation Agent Audit

Status: architecture review package; implementation has not started.

- Audit date: 2026-11-26
- Audited baseline: `8abb40b91` (`origin/main`)
- Audit branch: `codex/cli-next-audit-20261126`

## Decision summary

LiTT already has a credible local agent kernel. The next-generation effort should consolidate around `@litt/agent-core` and make LiTT CLI the local host behind every LiTT surface. It should not replace the working kernel with another agent loop.

The most important gap is architectural, not model quality: CLI and terminal-server execution use `ExecutionGateway`, while Studio's `runAgentLoopV2` uses a separate `PermissionEngine` and tool registry. Browser control, persistent memory, checkpoints, and many Studio tools exist, but they are not available through the CLI/core path. The plan therefore prioritizes contracts and adapters before adding features.

## Package contents

- [Architecture](architecture.md) — target topology, ownership boundaries, migration rules, and failure semantics.
- [Capability matrix](capability-matrix.md) — current capability status with implementation and test evidence.
- [Roadmap](roadmap.md) — prioritized delivery phases and exit gates.
- [Acceptance criteria](acceptance-criteria.md) — measurable program-level criteria.
- [Evidence](evidence.md) — commands executed, results, limitations, and audit provenance.
- [Implementation plan](../superpowers/plans/2026-11-26-litt-cli-next-generation-agent.md) — task-level, test-first execution plan.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Implemented and verified** | The code path exists and this audit found automated or live evidence that it works. |
| **Incomplete** | Useful implementation exists, but one or more required behaviors or evidence gates are absent. |
| **Broken** | A required path was exercised and failed. |
| **Disconnected** | Capability exists in the repository but is not reachable through the canonical CLI/core path. |
| **Duplicate** | Two or more implementations own the same concern and can diverge. |
| **Missing** | No suitable implementation was found. |

## Scope boundaries

This audit made no production code changes. It did not start another dev stack, use paid infrastructure, deploy, merge, push, or modify stable LOCAL/REMOTE routing, machine-lane safety, auth, approvals, Railway transport, provider selection, or destructive-command protection.

Windows received the deepest verification. WSL received build and command-launch smoke coverage. macOS and Termux remain unverified locally.
