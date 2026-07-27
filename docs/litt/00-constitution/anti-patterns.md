# LiTT Anti-Patterns

Patterns that must not emerge in the LiTT codebase.

## Architecture Anti-Patterns

### 1. One giant system prompt
Sending the entire document tree, every capability, every skill, and every
plugin to the model on every request. The prompt composer must load only
relevant sections.

### 2. One global Zustand store
A single store that owns chat, canvas, voice, projects, missions, tasks,
capabilities, and memory. This creates coupling and re-render storms. Each
subsystem keeps its own store; the Kernel composes a read-only view.

### 3. Disconnected Studio tools
Tools that maintain their own state, ignore the Kernel, and cannot be
coordinated. All tools register with the Kernel and consume Kernel context.

### 4. Competing sources of truth
Voice state in both a context and a store. Capability state in both a hook
and an endpoint with no reconciliation. Chat history in both an in-memory
store and a DB hook with no single owner.

### 5. Fake online agents
Permanent agent objects that claim to be "online" but have no real session,
no real model, and no real work. Use dynamic specialist roles only when
useful.

## Capability Anti-Patterns

### 6. Inferred readiness
Claiming a capability is ready because:
- a component rendered
- an environment variable exists
- a button exists
- a provider is configured
- a static agent object says online
- an LLM claims the capability works

Capabilities must be verified from real server or browser state.

### 7. Boolean capability collapse
Reducing a capability to `connected: true` when it has states like
`limited`, `degraded`, `requires_approval`, or `unknown`.

## Conversation Anti-Patterns

### 8. Project-gating general questions
Forcing Project setup before answering "what is a black hole?" General
knowledge must work without a Project.

### 9. Auto-creating permanent content
Creating a Canvas, Task, or File for every casual response. Only create
permanent content when intent is explicit or the user approves a suggestion.

### 10. Overwriting user content
Modifying a Canvas block, file, or artifact without recording a revision.
Every mutation must be reversible.

## Voice Anti-Patterns

### 11. Voice-Canvas coupling
Stopping TTS, restarting listening, or creating a duplicate voice session
when Canvas updates. Voice is independent of artifact execution.

### 12. Navigating away from chat
Switching routes or hiding the composer to use Canvas. The conversation
must remain accessible in every state.

## Truth Anti-Patterns

### 13. Confidence theater
Adding a percentage to every casual response. Visible confidence is for
research, forecasts, diagnostics, disputes, and high-risk decisions — not
"hello".

### 14. Completion inflation
Saying "complete," "all green," or "fully working" based only on
compilation or unit tests. Use the truthful labels from `north-star.md`.
