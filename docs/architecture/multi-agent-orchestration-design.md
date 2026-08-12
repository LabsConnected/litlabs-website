# Multi-Agent Orchestration Design

## Status: Architecture design only — not yet implemented

## Context

LiTT currently operates as a single Vapi assistant with 21 tools. The user
asked to "then add multi agents" after the single-agent execution is reliable.

The user's own guidance: "Multi-agent on top of unreliable execution just
gives you several agents confidently failing at once." This design assumes
the single-agent execution (the 21 tools built in this pass) is proven
reliable in production first.

## Why multi-agent

1. **Specialization**: A planning agent thinks about the problem; a coding
   agent writes code; a review agent checks the code. Each can have a
   smaller, more focused system prompt.
2. **Parallelism**: While one agent writes code, another can run tests on
   a previous change.
3. **Safety**: A reviewer agent can veto a coding agent's plan before it
   reaches production.
4. **Context limits**: Each agent has its own context window, so the
   planner doesn't need to see every file the coder read.

## Proposed architecture

```
USER (voice)
    ↓
LiTT ORCHESTRATOR (Vapi assistant — the only voice-facing agent)
    │
    ├── Plan Agent (text-only, no voice)
    │   └── Breaks down the request into steps
    │       └── Outputs: structured plan (JSON)
    │
    ├── Code Agent (text-only)
    │   └── Executes plan steps using the 21 tools
    │       └── Outputs: code changes, test results
    │
    └── Review Agent (text-only)
        └── Reviews the code agent's output
            └── Outputs: approve / request changes / reject
```

## Key design decisions

### 1. The orchestrator is the only voice-facing agent

The user talks to one LiTT. The orchestrator:
- Receives the voice request.
- Delegates to sub-agents via internal API calls (not Vapi).
- Reports results back to the user in natural speech.

Sub-agents never speak directly to the user. They communicate through
structured JSON passed back to the orchestrator.

### 2. Sub-agents use the same tool server

All agents (orchestrator, planner, coder, reviewer) call the same
`/api/vapi/tools` endpoint. The difference is:
- **Planner**: only calls read-only tools (`get_active_project`,
  `inspect_project_files`, `read_file`, `search_code`, `git_status`).
- **Coder**: calls all tools including mutating ones (`edit_file`,
  `commit_changes`, `push_branch`, `create_pull_request`).
- **Reviewer**: only calls read-only tools + `run_project_checks`.

This is enforced by a new `agent_role` parameter in the tool call that
the dispatcher checks against an allowlist per role.

### 3. Sub-agents are LLM calls, not Vapi assistants

Sub-agents are server-side LLM calls (OpenAI/Anthropic) made by the
orchestrator's backend, not separate Vapi assistants. This:
- Avoids Vapi per-assistant costs.
- Keeps all logic in the Next.js backend.
- Allows structured (non-voice) output.

### 4. Approval gates remain

The existing approval gates (`request_deployment_approval`,
`request_approval`) still apply. The orchestrator checks with the user
before any destructive action, regardless of which sub-agent proposed it.

### 5. Memory is shared

All agents read from and write to the same `memories` table (scoped by
`owner_id` + `project_id`). The `remember_project_context` tool is
available to the coder agent. The planner can recall memories to inform
its plan.

## Implementation phases

### Phase 1: Planner + Coder (MVP)

- Add a `/api/litt/orchestrate` endpoint that:
  1. Receives the user's request (text, from the orchestrator).
  2. Calls the LLM with a "planner" system prompt.
  3. Returns the plan as structured JSON.
  4. The orchestrator (Vapi) reads the plan to the user.
  5. On user confirmation, the orchestrator calls tools to execute.

**This is not yet multi-agent** — it's a single agent with a planning
step. But it's the foundation.

### Phase 2: Separate Coder Agent

- After the plan is confirmed, spawn a separate LLM call as the "coder"
  agent with a coding-focused system prompt.
- The coder calls tools directly via the existing tool server.
- The orchestrator polls for completion and reports results.

### Phase 3: Review Agent

- After the coder finishes, spawn a "reviewer" agent.
- The reviewer reads the changed files, runs checks, and outputs:
  `approve`, `request_changes`, or `reject`.
- If `request_changes`, the coder gets another turn.
- If `approve`, the orchestrator reports success to the user.

### Phase 4: Parallel agents

- Multiple coder agents work on independent plan steps in parallel.
- Requires workspace locking to prevent conflicting file writes.
- This is the most complex phase and should only be attempted after
  Phases 1-3 are stable.

## What does NOT change

- The 21 existing tools — they stay as-is.
- The Vapi assistant — it remains the single voice interface.
- The tool server (`/api/vapi/tools`) — same endpoint, same auth.
- The audit log — all agent tool calls are logged with their `agent_role`.
- The behavior contract — all agents are bound by the same honesty rules.

## Risks

| Risk | Mitigation |
|------|------------|
| Sub-agents hallucinate or go off-plan | Reviewer agent + approval gates |
| Latency: 3 LLM calls per request | Phase 1 only uses planner; coder is the existing flow |
| Cost: multiple LLM calls per request | Use cheaper models for planner/reviewer, premium for coder |
| Context loss between agents | Pass structured plan JSON between agents, not free text |
| Conflicting file writes | Workspace locking in Phase 4 |

## Prerequisites before implementation

1. Single-agent execution must be proven reliable in production.
2. The behavior contract must be demonstrably working (no false claims).
3. The 9 new tools (git, search, memory, approval, browser test) must be
   smoke-tested end-to-end via Vapi.
4. The Docker sandbox migration should be at least Phase 1 complete, so
   sub-agent-triggered commands run in isolation.

## Decision needed

Before implementation:
1. Which LLM provider for sub-agents? (OpenAI, Anthropic, or route via
   the existing AI model store?)
2. Should sub-agents be implemented as Edge Functions, or in the
   terminal server, or in Next.js API routes?
3. What's the max number of parallel agents per request? (affects cost
   and workspace contention)
