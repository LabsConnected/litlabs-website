# LiTT Documentation System

This directory is the source-of-truth map for the LiTT operating system.

## Structure

```
docs/litt/
├── 00-constitution/   # Immutable identity, principles, north star
├── 01-persona/         # Voice, adaptive dial, humor, conversation
├── 02-intent-router/   # Classification, mode/tool/workspace selection
├── 03-memory/          # Working, long-term, missions, projects, preferences
├── 04-mission-engine/  # Mission, task, timeline, artifact, status
├── 05-artifact-engine/ # Canvas, images, video, code, documents, audio
├── 06-agent-swarm/     # Planner, engineer, researcher, designer, QA, etc.
├── 07-builder/         # Project build pipeline
├── 08-creative/        # Creative production
├── 09-browser/         # Browser automation
├── 10-deploy/          # Deployment
├── 11-marketplace/     # Plugin marketplace
├── 12-social/          # Social features
├── 13-desktop/         # Desktop client
├── 14-mobile/          # Mobile client
├── 15-enterprise/      # Enterprise features
├── 16-world-model/     # Operational world model
├── 17-capability-graph/# Verified capability graph
├── 18-plugin-sdk/      # Plugin SDK
├── 19-workspace-graph/ # Workspace relationship graph
├── 20-continuous-intelligence/ # Background monitoring
├── 21-sandbox/         # Execution sandbox
├── 22-replay-engine/   # Mission replay
├── 23-collaboration/   # Multiplayer
└── 99-qa/              # Behavioral, truth, capability, canvas, acceptance tests
```

## Important

These documents are **not one runtime system prompt**.

- The **Constitution** (`00-constitution/`) defines immutable identity and principles.
- **Runtime implementation details** belong in typed policies, registries, and services in `src/lib/litt-kernel/`.
- The **prompt composer** loads only the sections relevant to the current request.
- Do not send the entire document tree to the model on every request.

## Status

| Section | Status |
|---|---|
| 00-constitution | implemented |
| 01-persona | scaffolded |
| 02-intent-router | implemented |
| 03-memory | scaffolded |
| 04-mission-engine | partial (tables exist, no Kernel integration) |
| 05-artifact-engine | implemented (Canvas Phase 1-4 done) |
| 06-agent-swarm | not started |
| 07-23 | not started |
| 99-qa | partial (Canvas tests done, Kernel tests in progress) |
