# Mission System v4.0 — Architecture Overview

> LiTT isn't another AI chat. It's a Builder OS where every mission has a crew, every crew shares memory, and every step from idea to deployment happens in one workspace.

## Core Components Built

| Component | File | Status | Purpose |
|-----------|------|--------|---------|
| **Mission Types** | `src/types/mission.ts` | ✅ | Mission, Crew, Memory, Artifacts types |
| **Mission Orchestrator** | `src/lib/MissionOrchestrator.ts` | ✅ | Event-driven mission engine |
| **Mission Scheduler** | `src/lib/MissionScheduler.ts` | ✅ | Deferred + cron + trigger execution |
| **Capability Router** | `src/lib/CapabilityRouter.ts` | ✅ | Route work to right agent |
| **Trust Engine** | `src/lib/TrustEngine.ts` | ✅ | Risk-based approvals |
| **Learning Engine** | `src/lib/LearningEngine.ts` | ✅ | Learn from successful missions |
| **Plugin Sandbox** | `src/lib/PluginSandbox.ts` | ✅ | Secure skill execution |

## Mission Object Schema

```typescript
Mission
├── id, name, goal, status
├── ownerId, visibility
├── createdAt, updatedAt

MissionRuntime
├── queue, activeStep, backgroundJobs
├── events, logs, resources, cost

Crew System
├── Commander (LiTT) - orchestrates
├── Architect - designs solution
├── Planner - creates step-by-step plan
├── Researcher - finds best solutions
├── Designer - UI/UX
├── Frontend Engineer - React/Next.js
├── Backend Engineer - API/database
├── QA Engineer - tests
└── DevOps - deployment
```

## Execution Flow

```
1. User: "Build a SaaS for pet sitters"
2. Mission Created → Trust Engine assesses risk
3. Scheduler queues steps:
   ├── Research competitors (immediate)
   ├── Design UI (scheduled)
   ├── Implement features (triggered on approval)
   └── Deploy after tests (event-driven)
4. Capability Router assigns to crew members
5. Plugin Sandbox runs each step in isolation
6. Learning Engine records outcome
7. Mission completes → User reviews → Approve/Reject
```

## Risk-Based Approvals

| Action | Risk Score | Requires Approval |
|--------|------------|-------------------|
| Delete database | 99 | ✅ Always |
| Production deploy | 85 | ✅ Always |
| Update dependencies | 75 | ✅ Always |
| Write component | 10 | ❌ Auto-approve |
| Update CSS | 15 | ❌ Auto-approve |

## Distributed Runtime Support (Planned)

```
Runtime
├── Local (this PC) - small edits
├── Docker - isolated builds
├── Cloud (Codespaces) - heavy builds
├── Edge - fast responses
└── GPU Workers - image/video generation
```

## Plugin Sandbox Permissions

```
Permission Types:
- read-files: Read project files
- write-files: Create/modify files
- execute-commands: Run terminal commands
- network-access: External APIs
- database-access: Supabase/PostgreSQL
- api-keys: Inject credentials
- deployment: Deploy to production
```

## Memory Hierarchy

```
Working Memory → Mission Memory → Project Memory → Global Knowledge
     ↓              ↓              ↓              ↓
  Temp notes    Context for      Project-wide    User preferences
                current step     conventions     across all missions
```

## What's Next (v4.1)

- [ ] **Governance Layer** - Audit logs, model versions, cost tracking
- [ ] **Digital Twin** - Live project state model
- [ ] **Mission Marketplace** - Share complete AI workflows
- [ ] **Replay/Rollback** - Undo any mission step
- [ ] **Health Monitoring** - Real-time system status

---

## Quick Test

```bash
# Visit the mission dashboard
http://localhost:3000/mission

# Create a mission via API
curl -X POST http://localhost:3000/api/mission \
  -H "Content-Type: application/json" \
  -d '{"goal": "Build a todo app", "userId": "test"}'
```

---

*The interface is effortless. The architecture is sophisticated.*